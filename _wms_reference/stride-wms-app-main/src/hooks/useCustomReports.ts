// Hook for managing custom reports

import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  CustomReport,
  ReportConfig,
  DataSourceId,
  FilterDefinition,
  ReportData,
  ColumnSelection,
} from '@/lib/reports/types';
import { DATA_SOURCES } from '@/lib/reports/dataSources';

export function useCustomReports() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [reports, setReports] = useState<CustomReport[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch all reports for the tenant
  const fetchReports = useCallback(async () => {
    if (!profile?.tenant_id) return;

    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('custom_reports')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .is('deleted_at', null)
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setReports((data || []) as CustomReport[]);
    } catch (e) {
      console.error('Error fetching reports:', e);
      toast({
        title: 'Error',
        description: 'Failed to load saved reports',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, toast]);

  // Create a new report
  const createReport = useCallback(
    async (
      name: string,
      description: string,
      dataSource: DataSourceId,
      config: ReportConfig
    ): Promise<CustomReport | null> => {
      if (!profile?.tenant_id || !profile?.id) return null;

      try {
        const { data, error } = await (supabase as any)
          .from('custom_reports')
          .insert({
            tenant_id: profile.tenant_id,
            name,
            description: description || null,
            data_source: dataSource,
            config: config,
            created_by: profile.id,
          })
          .select()
          .single();

        if (error) throw error;

        toast({
          title: 'Report saved',
          description: `"${name}" has been saved successfully.`,
        });

        await fetchReports();
        return data as CustomReport;
      } catch (e) {
        console.error('Error creating report:', e);
        toast({
          title: 'Error',
          description: 'Failed to save report',
          variant: 'destructive',
        });
        return null;
      }
    },
    [profile?.tenant_id, profile?.id, toast, fetchReports]
  );

  // Update an existing report
  const updateReport = useCallback(
    async (
      id: string,
      updates: Partial<Pick<CustomReport, 'name' | 'description' | 'config' | 'is_shared'>>
    ): Promise<boolean> => {
      try {
        const { error } = await (supabase as any)
          .from('custom_reports')
          .update(updates)
          .eq('id', id);

        if (error) throw error;

        toast({
          title: 'Report updated',
          description: 'Your changes have been saved.',
        });

        await fetchReports();
        return true;
      } catch (e) {
        console.error('Error updating report:', e);
        toast({
          title: 'Error',
          description: 'Failed to update report',
          variant: 'destructive',
        });
        return false;
      }
    },
    [toast, fetchReports]
  );

  // Delete a report (soft delete)
  const deleteReport = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const { error } = await (supabase as any)
          .from('custom_reports')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', id);

        if (error) throw error;

        toast({
          title: 'Report deleted',
          description: 'The report has been removed.',
        });

        await fetchReports();
        return true;
      } catch (e) {
        console.error('Error deleting report:', e);
        toast({
          title: 'Error',
          description: 'Failed to delete report',
          variant: 'destructive',
        });
        return false;
      }
    },
    [toast, fetchReports]
  );

  // Execute a report and return data
  const executeReport = useCallback(
    async (
      dataSource: DataSourceId,
      config: ReportConfig,
      reportId?: string,
      reportName?: string
    ): Promise<ReportData | null> => {
      if (!profile?.tenant_id) return null;

      const startTime = performance.now();

      try {
        const source = DATA_SOURCES[dataSource];
        if (!source) throw new Error(`Unknown data source: ${dataSource}`);

        // Build select statement (only direct columns, no joins)
        // Note: summaries/visualizations may reference columns that are not visible.
        // We still need to select them so those computations work.
        const visibleColumns = config.columns.filter((c) => c.visible);
        const queryColumnIds = new Set<string>(visibleColumns.map((c) => c.id));

        for (const s of config.summaries || []) {
          if (s?.column) queryColumnIds.add(s.column);
        }

        // Future-proof: if chartConfig is provided, ensure we select the needed columns
        const chartAny: any = (config as any).chartConfig;
        const chartGroupBy = typeof chartAny?.groupBy === 'string' ? chartAny.groupBy : null;
        const chartValueCol = typeof chartAny?.valueColumn === 'string' ? chartAny.valueColumn : null;
        if (chartGroupBy) queryColumnIds.add(chartGroupBy);
        if (chartValueCol) queryColumnIds.add(chartValueCol);

        const queryColumns: ColumnSelection[] = Array.from(queryColumnIds)
          .map((id) => {
            const existing = config.columns.find((c) => c.id === id);
            if (existing) return existing;
            const def = source.columns.find((c) => c.id === id);
            if (!def) return null;
            return { id: def.id, label: def.label, visible: false, format: def.format, width: def.width };
          })
          .filter(Boolean) as ColumnSelection[];

        const selectFields = buildSelectFields(dataSource, queryColumns);

        // Start query
        let query = (supabase as any)
          .from(source.tableName)
          .select(selectFields, { count: 'exact' })
          .eq('tenant_id', profile.tenant_id);
        
        // Only apply deleted_at filter for sources that support soft-delete
        if (source.hasDeletedAt !== false) {
          query = query.is('deleted_at', null);
        }

        // Apply filters
        query = applyFilters(query, config.filters, source);

        // Apply sorting
        if (config.orderBy.length > 0) {
          config.orderBy.forEach((sort) => {
            const col = source.columns.find((c) => c.id === sort.column);
            if (col && !col.joinTable) {
              // Only sort by direct columns, not joined ones
              query = query.order(col.dbColumn, { ascending: sort.direction === 'asc' });
            }
          });
        } else if (source.defaultSort) {
          source.defaultSort.forEach((sort) => {
            query = query.order(sort.column, { ascending: sort.direction === 'asc' });
          });
        }

        // Apply limit
        const limit = config.limit || 1000;
        query = query.limit(limit);

        const { data, count, error } = await query;

        if (error) throw error;

        // Fetch related data for joined columns
        const enrichedData = await enrichWithJoinedData(data || [], dataSource, queryColumns);

        const executionTime = Math.round(performance.now() - startTime);

        // Transform data for display
        const rows = transformRows(enrichedData, dataSource, queryColumns);

        // Calculate summaries
        const summaries = calculateSummaries(rows, config.summaries);

        // Log execution
        await logExecution(
          profile.tenant_id,
          profile.id || '',
          reportId || null,
          reportName || 'Ad-hoc Report',
          dataSource,
          config.filters,
          count || rows.length,
          executionTime
        );

        return {
          rows,
          totalCount: count || rows.length,
          summaries,
          executionTime,
        };
      } catch (e) {
        console.error('Error executing report:', e);
        toast({
          title: 'Error',
          description: 'Failed to run report',
          variant: 'destructive',
        });
        return null;
      }
    },
    [profile?.tenant_id, profile?.id, toast]
  );

  return {
    reports,
    loading,
    fetchReports,
    createReport,
    updateReport,
    deleteReport,
    executeReport,
  };
}

// Helper: Build select fields string (only direct columns, no joins)
function buildSelectFields(dataSourceId: string, columns: ColumnSelection[]): string {
  const source = DATA_SOURCES[dataSourceId];
  if (!source) return '*';

  const fields: string[] = ['id'];

  columns.forEach((col) => {
    const colDef = source.columns.find((c) => c.id === col.id);
    if (colDef) {
      // For joined columns, we need to include the FK column (dbColumn)
      // For direct columns, just include them
      if (!fields.includes(colDef.dbColumn)) {
        fields.push(colDef.dbColumn);
      }
    }
  });

  // Always include tenant_id for filtering
  if (!fields.includes('tenant_id')) fields.push('tenant_id');

  return fields.join(', ');
}

// Helper: Fetch related data for joined columns
async function enrichWithJoinedData(
  data: Record<string, unknown>[],
  dataSourceId: string,
  columns: ColumnSelection[]
): Promise<Record<string, unknown>[]> {
  const source = DATA_SOURCES[dataSourceId];
  if (!source || data.length === 0) return data;

  // Find all columns that need joins
  const joinConfigs: { colDef: typeof source.columns[0]; fkIds: Set<string> }[] = [];

  columns.forEach((col) => {
    const colDef = source.columns.find((c) => c.id === col.id);
    if (colDef?.joinTable && colDef?.joinColumn) {
      // Collect unique FK IDs for this join
      const fkIds = new Set<string>();
      data.forEach((row) => {
        const fkValue = row[colDef.dbColumn];
        if (fkValue && typeof fkValue === 'string') {
          fkIds.add(fkValue);
        }
      });

      if (fkIds.size > 0) {
        // Check if we already have this join table
        const existing = joinConfigs.find((j) => j.colDef.joinTable === colDef.joinTable);
        if (existing) {
          fkIds.forEach((id) => existing.fkIds.add(id));
        } else {
          joinConfigs.push({ colDef, fkIds });
        }
      }
    }
  });

  // Fetch data for each join table
  const lookupMaps: Record<string, Record<string, Record<string, unknown>>> = {};

  await Promise.all(
    joinConfigs.map(async ({ colDef, fkIds }) => {
      if (!colDef.joinTable || !colDef.joinColumn) return;

      const ids = Array.from(fkIds);
      if (ids.length === 0) return;

      // Determine which columns we need from the joined table
      const neededColumns = new Set<string>(['id']);
      columns.forEach((col) => {
        const cd = source.columns.find((c) => c.id === col.id);
        if (cd?.joinTable === colDef.joinTable && cd?.joinColumn) {
          neededColumns.add(cd.joinColumn);
        }
      });

      const { data: joinedData } = await (supabase as any)
        .from(colDef.joinTable)
        .select(Array.from(neededColumns).join(', '))
        .in('id', ids);

      if (joinedData && Array.isArray(joinedData)) {
        if (!lookupMaps[colDef.joinTable]) {
          lookupMaps[colDef.joinTable] = {};
        }
        (joinedData as Record<string, unknown>[]).forEach((row) => {
          lookupMaps[colDef.joinTable!][row.id as string] = row;
        });
      }
    })
  );

  // Enrich data with joined values
  return data.map((row) => {
    const enriched = { ...row };

    columns.forEach((col) => {
      const colDef = source.columns.find((c) => c.id === col.id);
      if (colDef?.joinTable && colDef?.joinColumn) {
        const fkValue = row[colDef.dbColumn] as string;
        const lookup = lookupMaps[colDef.joinTable];
        if (fkValue && lookup && lookup[fkValue]) {
          // Store the joined value with a special key
          enriched[`__joined_${col.id}`] = lookup[fkValue][colDef.joinColumn];
        }
      }
    });

    return enriched;
  });
}

// Helper: Apply filters to query
function applyFilters(
  query: any,
  filters: FilterDefinition[],
  source: (typeof DATA_SOURCES)[string]
): any {
  filters.forEach((filter) => {
    const colDef = source.columns.find((c) => c.id === filter.column);
    if (!colDef) return;

    const dbCol = colDef.dbColumn;

    switch (filter.operator) {
      case 'eq':
        query = query.eq(dbCol, filter.value);
        break;
      case 'ne':
        query = query.neq(dbCol, filter.value);
        break;
      case 'gt':
        query = query.gt(dbCol, filter.value);
        break;
      case 'gte':
        query = query.gte(dbCol, filter.value);
        break;
      case 'lt':
        query = query.lt(dbCol, filter.value);
        break;
      case 'lte':
        query = query.lte(dbCol, filter.value);
        break;
      case 'contains':
        query = query.ilike(dbCol, `%${filter.value}%`);
        break;
      case 'in':
        if (Array.isArray(filter.value)) {
          query = query.in(dbCol, filter.value);
        }
        break;
      case 'between':
        if (Array.isArray(filter.value) && filter.value.length === 2) {
          query = query.gte(dbCol, filter.value[0]).lte(dbCol, filter.value[1]);
        }
        break;
      case 'is_null':
        query = query.is(dbCol, null);
        break;
      case 'is_not_null':
        query = query.not(dbCol, 'is', null);
        break;
    }
  });

  return query;
}

// Helper: Transform raw data rows for display
function transformRows(
  data: Record<string, unknown>[],
  dataSourceId: string,
  columns: ColumnSelection[]
): Record<string, unknown>[] {
  const source = DATA_SOURCES[dataSourceId];
  if (!source) return data;

  return data.map((row) => {
    const transformed: Record<string, unknown> = { id: row.id };

    columns.forEach((col) => {
      const colDef = source.columns.find((c) => c.id === col.id);
      if (!colDef) return;

      if (colDef.joinTable && colDef.joinColumn) {
        // Get the enriched value from the joined lookup
        transformed[col.id] = row[`__joined_${col.id}`] ?? null;
      } else {
        transformed[col.id] = row[colDef.dbColumn];
      }
    });

    return transformed;
  });
}

// Helper: Calculate summary values
function calculateSummaries(
  rows: Record<string, unknown>[],
  summaries: { id: string; column: string; aggregation: string; label: string }[]
): Record<string, number> {
  const result: Record<string, number> = {};

  summaries.forEach((summary) => {
    const values = rows
      .map((r) => r[summary.column])
      .filter((v) => v !== null && v !== undefined)
      .map((v) => Number(v))
      .filter((v) => !isNaN(v));

    switch (summary.aggregation) {
      case 'sum':
        result[summary.id] = values.reduce((a, b) => a + b, 0);
        break;
      case 'count':
        result[summary.id] = values.length;
        break;
      case 'avg':
        result[summary.id] = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
        break;
      case 'min':
        result[summary.id] = values.length > 0 ? Math.min(...values) : 0;
        break;
      case 'max':
        result[summary.id] = values.length > 0 ? Math.max(...values) : 0;
        break;
    }
  });

  return result;
}

// Helper: Log report execution
async function logExecution(
  tenantId: string,
  userId: string,
  reportId: string | null,
  reportName: string,
  dataSource: DataSourceId,
  filters: FilterDefinition[],
  rowCount: number,
  executionTime: number
): Promise<void> {
  try {
    await (supabase as any).from('report_executions').insert({
      tenant_id: tenantId,
      report_id: reportId,
      report_name: reportName,
      data_source: dataSource,
      filters_applied: filters,
      row_count: rowCount,
      execution_time_ms: executionTime,
      executed_by: userId,
    });
  } catch (e) {
    // Silently fail - logging shouldn't break the report
    console.error('Failed to log report execution:', e);
  }
}
