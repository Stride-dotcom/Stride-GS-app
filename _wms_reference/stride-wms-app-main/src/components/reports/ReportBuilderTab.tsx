import { useState, useEffect, useMemo, useCallback } from 'react';
import { useCustomReports } from '@/hooks/useCustomReports';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  CustomReport,
  ReportConfig,
  DataSourceId,
  FilterDefinition,
  ColumnSelection,
  SortDefinition,
  SummaryDefinition,
  ReportData,
  OPERATOR_OPTIONS,
  AGGREGATION_OPTIONS,
  type ChartConfig,
  type AggregationType,
} from '@/lib/reports/types';
import { DATA_SOURCES, getDefaultColumns, getAvailableColumns } from '@/lib/reports/dataSources';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import ExcelJS from 'exceljs';
import { addJsonSheet, downloadWorkbook } from '@/lib/excelUtils';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

// Default empty config
const getEmptyConfig = (): ReportConfig => ({
  columns: [],
  filters: [],
  orderBy: [],
  summaries: [],
  limit: 1000,
});

const CHART_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--secondary))',
  'hsl(var(--accent))',
  'hsl(var(--muted))',
  'hsl(var(--chart-5, 210 40% 60%))',
];

export function ReportBuilderTab() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const {
    reports,
    loading: reportsLoading,
    fetchReports,
    createReport,
    updateReport,
    deleteReport,
    executeReport,
  } = useCustomReports();

  // Current report state
  const [currentReport, setCurrentReport] = useState<CustomReport | null>(null);
  const [dataSource, setDataSource] = useState<DataSourceId>('items');
  const [config, setConfig] = useState<ReportConfig>(getEmptyConfig());
  const [reportName, setReportName] = useState('');
  const [reportDescription, setReportDescription] = useState('');

  // Execution state
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [executing, setExecuting] = useState(false);

  // Dialog state
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [loadDialogOpen, setLoadDialogOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Load reports on mount
  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  // Initialize columns when data source changes
  useEffect(() => {
    const defaultCols = getDefaultColumns(dataSource);
    setConfig((prev) => ({
      ...prev,
      columns: defaultCols.map((col) => ({
        id: col.id,
        label: col.label,
        visible: true,
        format: col.format,
      })),
      filters: [],
      orderBy: DATA_SOURCES[dataSource]?.defaultSort || [],
      summaries: [],
      chartConfig: undefined,
    }));
    setReportData(null);
  }, [dataSource]);

  // Get available columns for current data source
  const availableColumns = useMemo(() => getAvailableColumns(dataSource), [dataSource]);

  // Run the report
  const handleRunReport = async () => {
    setExecuting(true);
    try {
      const result = await executeReport(
        dataSource,
        config,
        currentReport?.id,
        currentReport?.name || reportName || 'Ad-hoc Report'
      );
      setReportData(result);
    } finally {
      setExecuting(false);
    }
  };

  // Save report
  const handleSaveReport = async () => {
    if (!reportName.trim()) {
      toast({
        title: 'Name required',
        description: 'Please enter a name for the report.',
        variant: 'destructive',
      });
      return;
    }

    if (currentReport) {
      // Update existing
      const success = await updateReport(currentReport.id, {
        name: reportName,
        description: reportDescription,
        config,
      });
      if (success) {
        setCurrentReport({ ...currentReport, name: reportName, description: reportDescription, config });
        setSaveDialogOpen(false);
      }
    } else {
      // Create new
      const newReport = await createReport(reportName, reportDescription, dataSource, config);
      if (newReport) {
        setCurrentReport(newReport);
        setSaveDialogOpen(false);
      }
    }
  };

  // Load a saved report
  const handleLoadReport = (report: CustomReport) => {
    setCurrentReport(report);
    setDataSource(report.data_source);
    setConfig(report.config);
    setReportName(report.name);
    setReportDescription(report.description || '');
    setReportData(null);
    setLoadDialogOpen(false);
  };

  // Delete a report
  const handleDeleteReport = async (id: string) => {
    await deleteReport(id);
    if (currentReport?.id === id) {
      handleNewReport();
    }
    setConfirmDeleteId(null);
  };

  // Start a new report
  const handleNewReport = () => {
    setCurrentReport(null);
    setDataSource('items');
    setConfig(getEmptyConfig());
    setReportName('');
    setReportDescription('');
    setReportData(null);
  };

  // Add a filter
  const handleAddFilter = () => {
    const firstCol = availableColumns.find((c) => c.filterable);
    if (!firstCol) return;

    const operators = OPERATOR_OPTIONS[firstCol.format] || OPERATOR_OPTIONS.text;
    const newFilter: FilterDefinition = {
      id: crypto.randomUUID(),
      column: firstCol.id,
      operator: operators[0].value,
      value: '',
    };

    setConfig((prev) => ({
      ...prev,
      filters: [...prev.filters, newFilter],
    }));
  };

  // Update a filter
  const handleUpdateFilter = (id: string, updates: Partial<FilterDefinition>) => {
    setConfig((prev) => ({
      ...prev,
      filters: prev.filters.map((f) => (f.id === id ? { ...f, ...updates } : f)),
    }));
  };

  // Remove a filter
  const handleRemoveFilter = (id: string) => {
    setConfig((prev) => ({
      ...prev,
      filters: prev.filters.filter((f) => f.id !== id),
    }));
  };

  // Toggle column visibility
  const handleToggleColumn = (columnId: string) => {
    setConfig((prev) => {
      const existing = prev.columns.find((c) => c.id === columnId);
      if (existing) {
        return {
          ...prev,
          columns: prev.columns.map((c) =>
            c.id === columnId ? { ...c, visible: !c.visible } : c
          ),
        };
      } else {
        const colDef = availableColumns.find((c) => c.id === columnId);
        if (!colDef) return prev;
        return {
          ...prev,
          columns: [
            ...prev.columns,
            { id: colDef.id, label: colDef.label, visible: true, format: colDef.format },
          ],
        };
      }
    });
  };

  // Add a summary
  const handleAddSummary = () => {
    const aggregatableCol = availableColumns.find((c) => c.aggregatable);
    if (!aggregatableCol) {
      toast({
        title: 'No aggregatable columns',
        description: 'This data source has no numeric columns to summarize.',
        variant: 'destructive',
      });
      return;
    }

    const newSummary: SummaryDefinition = {
      id: crypto.randomUUID(),
      column: aggregatableCol.id,
      aggregation: 'sum',
      label: `Total ${aggregatableCol.label}`,
    };

    setConfig((prev) => ({
      ...prev,
      summaries: [...prev.summaries, newSummary],
    }));
  };

  // Update a summary
  const handleUpdateSummary = (id: string, updates: Partial<SummaryDefinition>) => {
    setConfig((prev) => ({
      ...prev,
      summaries: prev.summaries.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    }));
  };

  // Remove a summary
  const handleRemoveSummary = (id: string) => {
    setConfig((prev) => ({
      ...prev,
      summaries: prev.summaries.filter((s) => s.id !== id),
    }));
  };

  // Toggle sort
  const handleToggleSort = (columnId: string) => {
    setConfig((prev) => {
      const existing = prev.orderBy.find((o) => o.column === columnId);
      if (existing) {
        if (existing.direction === 'asc') {
          return {
            ...prev,
            orderBy: prev.orderBy.map((o) =>
              o.column === columnId ? { ...o, direction: 'desc' } : o
            ),
          };
        } else {
          return {
            ...prev,
            orderBy: prev.orderBy.filter((o) => o.column !== columnId),
          };
        }
      } else {
        return {
          ...prev,
          orderBy: [...prev.orderBy, { column: columnId, direction: 'asc' }],
        };
      }
    });
  };

  // Export to CSV
  const handleExportCSV = () => {
    if (!reportData || reportData.rows.length === 0) return;

    const visibleColumns = config.columns.filter((c) => c.visible);
    const headers = visibleColumns.map((c) => c.label);

    const csvRows = [headers.join(',')];

    reportData.rows.forEach((row) => {
      const values = visibleColumns.map((col) => {
        const val = row[col.id];
        if (val === null || val === undefined) return '';
        const str = String(val);
        // Escape quotes and wrap in quotes if contains comma
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      });
      csvRows.push(values.join(','));
    });

    const csv = csvRows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${reportName || 'report'}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Export to Excel
  const handleExportExcel = async () => {
    if (!reportData || reportData.rows.length === 0) return;

    const visibleColumns = config.columns.filter((c) => c.visible);

    const worksheetData = reportData.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      visibleColumns.forEach((col) => {
        obj[col.label] = row[col.id];
      });
      return obj;
    });

    const workbook = new ExcelJS.Workbook();
    addJsonSheet(workbook, worksheetData, 'Report');

    // Add summary sheet if summaries exist
    if (config.summaries.length > 0 && Object.keys(reportData.summaries).length > 0) {
      const summaryData = config.summaries.map((s) => ({
        Metric: s.label,
        Value: reportData.summaries[s.id] || 0,
      }));
      addJsonSheet(workbook, summaryData, 'Summary');
    }

    await downloadWorkbook(workbook, `${reportName || 'report'}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // Format cell value for display
  const formatCellValue = (value: unknown, format: string): string => {
    if (value === null || value === undefined) return '-';

    switch (format) {
      case 'currency':
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
        }).format(Number(value));
      case 'number':
        return new Intl.NumberFormat('en-US').format(Number(value));
      case 'date':
        return new Date(String(value)).toLocaleDateString();
      case 'datetime':
        return new Date(String(value)).toLocaleString();
      case 'boolean':
        return value ? 'Yes' : 'No';
      default:
        return String(value);
    }
  };

  // Get badge variant for status columns
  const getBadgeVariant = (columnId: string, value: unknown): string => {
    const colDef = availableColumns.find((c) => c.id === columnId);
    if (colDef?.badgeConfig && value) {
      return colDef.badgeConfig[String(value)]?.variant || 'outline';
    }
    return 'outline';
  };

  const visibleColumns = config.columns.filter((c) => c.visible);

  const chartComputed = useMemo(() => {
    const cc = config.chartConfig;
    if (!cc || !cc.type) return null;
    if (!reportData || !Array.isArray(reportData.rows) || reportData.rows.length === 0) return null;

    const groupById = cc.groupBy || cc.xAxis || cc.groupBy;
    if (!groupById) return null;

    const aggregation: AggregationType = (cc.aggregation as any) || 'count';
    const valueColumnId = cc.valueColumn || cc.yAxis || undefined;
    const maxGroups = Math.max(3, Math.min(50, Number(cc.maxGroups) || 12));

    const groupByDef = availableColumns.find((c) => c.id === groupById);
    const valueDef = valueColumnId ? availableColumns.find((c) => c.id === valueColumnId) : null;

    type Agg = { name: string; count: number; sum: number; min: number; max: number };
    const map = new Map<string, Agg>();

    const normalizeGroupName = (raw: unknown) => {
      if (raw === null || raw === undefined || raw === '') return '—';
      if (groupByDef?.format === 'boolean') return raw ? 'Yes' : 'No';
      if (groupByDef?.format === 'date') return new Date(String(raw)).toLocaleDateString();
      if (groupByDef?.format === 'datetime') return new Date(String(raw)).toLocaleString();
      return String(raw);
    };

    for (const row of reportData.rows) {
      const groupValue = (row as any)[groupById];
      const name = normalizeGroupName(groupValue);

      const agg = map.get(name) || { name, count: 0, sum: 0, min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY };
      agg.count += 1;

      if (aggregation !== 'count') {
        const rawVal = valueColumnId ? (row as any)[valueColumnId] : null;
        const n = typeof rawVal === 'number' && Number.isFinite(rawVal) ? rawVal : Number(rawVal);
        if (Number.isFinite(n)) {
          agg.sum += n;
          agg.min = Math.min(agg.min, n);
          agg.max = Math.max(agg.max, n);
        }
      }

      map.set(name, agg);
    }

    const points = Array.from(map.values()).map((a) => {
      let value = a.count;
      if (aggregation === 'sum') value = a.sum;
      if (aggregation === 'avg') value = a.count > 0 ? a.sum / a.count : 0;
      if (aggregation === 'min') value = Number.isFinite(a.min) ? a.min : 0;
      if (aggregation === 'max') value = Number.isFinite(a.max) ? a.max : 0;
      return { name: a.name, value };
    });

    points.sort((a, b) => (b.value || 0) - (a.value || 0));

    const sliced = points.slice(0, maxGroups);

    const metricFormat =
      aggregation === 'count'
        ? 'number'
        : (valueDef?.format === 'currency' ? 'currency' : 'number');

    const titleParts = [
      cc.type.toUpperCase(),
      'chart',
      '•',
      aggregation.toUpperCase(),
      aggregation === 'count' ? '' : (valueDef?.label ? `of ${valueDef.label}` : ''),
      'by',
      groupByDef?.label || groupById,
    ].filter(Boolean);

    return {
      type: cc.type,
      title: titleParts.join(' '),
      data: sliced,
      metricFormat,
    };
  }, [config.chartConfig, reportData, availableColumns]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">
            {currentReport ? currentReport.name : 'Custom Report Builder'}
          </h2>
          <p className="text-muted-foreground text-sm">
            {currentReport
              ? currentReport.description || 'Build and customize your own reports'
              : 'Build and customize your own reports'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setLoadDialogOpen(true)}>
            <MaterialIcon name="folder_open" size="sm" className="mr-2" />
            Load
          </Button>
          <Button variant="outline" size="sm" onClick={handleNewReport}>
            <MaterialIcon name="add" size="sm" className="mr-2" />
            New
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSaveDialogOpen(true)}
            disabled={config.columns.filter((c) => c.visible).length === 0}
          >
            <MaterialIcon name="save" size="sm" className="mr-2" />
            Save
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={!reportData || reportData.rows.length === 0}
              >
                <MaterialIcon name="download" size="sm" className="mr-2" />
                Export
                <MaterialIcon name="expand_more" size="sm" className="ml-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={handleExportCSV}>
                <MaterialIcon name="description" size="sm" className="mr-2" />
                Export CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportExcel}>
                <MaterialIcon name="description" size="sm" className="mr-2" />
                Export Excel
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={handleRunReport} disabled={executing || visibleColumns.length === 0}>
            {executing ? (
              <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
            ) : (
              <MaterialIcon name="play_arrow" size="sm" className="mr-2" />
            )}
            Run Report
          </Button>
        </div>
      </div>

      {/* Configuration Panel */}
      <Card>
        <CardContent className="pt-4">
          <Accordion type="multiple" defaultValue={['source', 'columns', 'filters']} className="space-y-2">
            {/* Data Source */}
            <AccordionItem value="source" className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center gap-2">
                  <MaterialIcon name="settings" size="sm" />
                  <span className="font-medium">Data Source</span>
                  <Badge variant="secondary" className="ml-2">
                    {DATA_SOURCES[dataSource]?.label}
                  </Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pt-4 pb-2">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                  {Object.values(DATA_SOURCES).map((source) => (
                    <button
                      key={source.id}
                      onClick={() => setDataSource(source.id)}
                      className={`p-3 rounded-lg border text-left transition-colors ${
                        dataSource === source.id
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      <div className="font-medium text-sm">{source.label}</div>
                      <div className="text-xs text-muted-foreground mt-1">{source.description}</div>
                    </button>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Columns */}
            <AccordionItem value="columns" className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center gap-2">
                  <MaterialIcon name="settings" size="sm" />
                  <span className="font-medium">Columns</span>
                  <Badge variant="secondary" className="ml-2">
                    {visibleColumns.length} selected
                  </Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pt-4 pb-2">
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                  {availableColumns.map((col) => {
                    const isSelected = config.columns.some((c) => c.id === col.id && c.visible);
                    return (
                      <label
                        key={col.id}
                        className={`flex items-center gap-2 p-2 rounded border cursor-pointer transition-colors ${
                          isSelected ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
                        }`}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => handleToggleColumn(col.id)}
                        />
                        <span className="text-sm">{col.label}</span>
                      </label>
                    );
                  })}
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Filters */}
            <AccordionItem value="filters" className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center gap-2">
                  <MaterialIcon name="settings" size="sm" />
                  <span className="font-medium">Filters</span>
                  {config.filters.length > 0 && (
                    <Badge variant="secondary" className="ml-2">
                      {config.filters.length} active
                    </Badge>
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent className="pt-4 pb-2 space-y-3">
                {config.filters.map((filter) => {
                  const colDef = availableColumns.find((c) => c.id === filter.column);
                  const operators = colDef ? OPERATOR_OPTIONS[colDef.format] || OPERATOR_OPTIONS.text : OPERATOR_OPTIONS.text;

                  return (
                    <div key={filter.id} className="flex items-center gap-2">
                      <Select
                        value={filter.column}
                        onValueChange={(v) => {
                          const newColDef = availableColumns.find((c) => c.id === v);
                          const newOps = newColDef ? OPERATOR_OPTIONS[newColDef.format] || OPERATOR_OPTIONS.text : OPERATOR_OPTIONS.text;
                          handleUpdateFilter(filter.id, {
                            column: v,
                            operator: newOps[0].value,
                            value: '',
                          });
                        }}
                      >
                        <SelectTrigger className="w-[180px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {availableColumns
                            .filter((c) => c.filterable)
                            .map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.label}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>

                      <Select
                        value={filter.operator}
                        onValueChange={(v) =>
                          handleUpdateFilter(filter.id, { operator: v as FilterDefinition['operator'] })
                        }
                      >
                        <SelectTrigger className="w-[150px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {operators.map((op) => (
                            <SelectItem key={op.value} value={op.value}>
                              {op.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {filter.operator !== 'is_null' && filter.operator !== 'is_not_null' && (
                        <Input
                          value={String(filter.value || '')}
                          onChange={(e) => handleUpdateFilter(filter.id, { value: e.target.value })}
                          placeholder="Value..."
                          className="flex-1"
                          type={colDef?.format === 'number' || colDef?.format === 'currency' ? 'number' : colDef?.format === 'date' ? 'date' : 'text'}
                        />
                      )}

                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveFilter(filter.id)}
                        className="text-destructive hover:text-destructive"
                      >
                        <MaterialIcon name="close" size="sm" />
                      </Button>
                    </div>
                  );
                })}

                <Button variant="outline" size="sm" onClick={handleAddFilter}>
                  <MaterialIcon name="add" size="sm" className="mr-2" />
                  Add Filter
                </Button>
              </AccordionContent>
            </AccordionItem>

            {/* Summaries */}
            <AccordionItem value="summaries" className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center gap-2">
                  <MaterialIcon name="settings" size="sm" />
                  <span className="font-medium">Summaries</span>
                  {config.summaries.length > 0 && (
                    <Badge variant="secondary" className="ml-2">
                      {config.summaries.length} configured
                    </Badge>
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent className="pt-4 pb-2 space-y-3">
                {config.summaries.map((summary) => {
                  const aggregatableCols = availableColumns.filter((c) => c.aggregatable);

                  return (
                    <div key={summary.id} className="flex items-center gap-2">
                      <Select
                        value={summary.aggregation}
                        onValueChange={(v) =>
                          handleUpdateSummary(summary.id, {
                            aggregation: v as SummaryDefinition['aggregation'],
                          })
                        }
                      >
                        <SelectTrigger className="w-[120px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {AGGREGATION_OPTIONS.map((op) => (
                            <SelectItem key={op.value} value={op.value}>
                              {op.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <span className="text-muted-foreground">of</span>

                      <Select
                        value={summary.column}
                        onValueChange={(v) => {
                          const col = aggregatableCols.find((c) => c.id === v);
                          handleUpdateSummary(summary.id, {
                            column: v,
                            label: col ? `${summary.aggregation === 'sum' ? 'Total' : summary.aggregation === 'avg' ? 'Avg' : summary.aggregation === 'count' ? 'Count' : summary.aggregation} ${col.label}` : summary.label,
                          });
                        }}
                      >
                        <SelectTrigger className="w-[180px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {aggregatableCols.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <span className="text-muted-foreground">as</span>

                      <Input
                        value={summary.label}
                        onChange={(e) => handleUpdateSummary(summary.id, { label: e.target.value })}
                        placeholder="Label..."
                        className="flex-1"
                      />

                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveSummary(summary.id)}
                        className="text-destructive hover:text-destructive"
                      >
                        <MaterialIcon name="close" size="sm" />
                      </Button>
                    </div>
                  );
                })}

                <Button variant="outline" size="sm" onClick={handleAddSummary}>
                  <MaterialIcon name="add" size="sm" className="mr-2" />
                  Add Summary
                </Button>
              </AccordionContent>
            </AccordionItem>

            {/* Visualization */}
            <AccordionItem value="visualization" className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center gap-2">
                  <MaterialIcon name="insights" size="sm" />
                  <span className="font-medium">Visualization</span>
                  {config.chartConfig?.type && (
                    <Badge variant="secondary" className="ml-2 capitalize">
                      {config.chartConfig.type} chart
                    </Badge>
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent className="pt-4 pb-2 space-y-3">
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-2">
                    <Label>Chart</Label>
                    <Select
                      value={config.chartConfig?.type ?? 'none'}
                      onValueChange={(v) => {
                        if (v === 'none') {
                          setConfig((prev) => ({ ...prev, chartConfig: undefined }));
                          return;
                        }

                        setConfig((prev) => {
                          const groupByDefault =
                            prev.chartConfig?.groupBy
                            || availableColumns.find((c) => c.filterable)?.id
                            || availableColumns[0]?.id
                            || '';

                          const metricDefault =
                            prev.chartConfig?.valueColumn
                            || availableColumns.find((c) => c.aggregatable)?.id;

                          const next: ChartConfig = {
                            type: v as any,
                            groupBy: groupByDefault || undefined,
                            aggregation: prev.chartConfig?.aggregation || ('count' as AggregationType),
                            valueColumn: metricDefault,
                            maxGroups: prev.chartConfig?.maxGroups ?? 12,
                          };

                          return { ...prev, chartConfig: next };
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="bar">Bar</SelectItem>
                        <SelectItem value="line">Line</SelectItem>
                        <SelectItem value="pie">Pie</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Group by</Label>
                    <Select
                      value={config.chartConfig?.groupBy ?? ''}
                      onValueChange={(v) =>
                        setConfig((prev) => ({
                          ...prev,
                          chartConfig: prev.chartConfig ? { ...prev.chartConfig, groupBy: v } : prev.chartConfig,
                        }))
                      }
                      disabled={!config.chartConfig}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select column" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableColumns
                          .filter((c) => c.filterable)
                          .map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.label}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Metric</Label>
                    <Select
                      value={config.chartConfig?.aggregation ?? 'count'}
                      onValueChange={(v) =>
                        setConfig((prev) => ({
                          ...prev,
                          chartConfig: prev.chartConfig ? { ...prev.chartConfig, aggregation: v as AggregationType } : prev.chartConfig,
                        }))
                      }
                      disabled={!config.chartConfig}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {AGGREGATION_OPTIONS.map((op) => (
                          <SelectItem key={op.value} value={op.value}>
                            {op.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Value column</Label>
                    <Select
                      value={config.chartConfig?.valueColumn ?? ''}
                      onValueChange={(v) =>
                        setConfig((prev) => ({
                          ...prev,
                          chartConfig: prev.chartConfig ? { ...prev.chartConfig, valueColumn: v } : prev.chartConfig,
                        }))
                      }
                      disabled={!config.chartConfig || (config.chartConfig?.aggregation ?? 'count') === 'count'}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="(Not needed for count)" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableColumns
                          .filter((c) => c.aggregatable)
                          .map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.label}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Max groups</Label>
                    <Input
                      type="number"
                      min={3}
                      max={50}
                      value={config.chartConfig?.maxGroups ?? 12}
                      disabled={!config.chartConfig}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          chartConfig: prev.chartConfig
                            ? {
                                ...prev.chartConfig,
                                maxGroups: Math.max(3, Math.min(50, Number(e.target.value) || 12)),
                              }
                            : prev.chartConfig,
                        }))
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Charts use the current report limit ({config.limit || 1000} rows).
                    </p>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>

      {/* Summary Cards (if summaries configured and data available) */}
      {reportData && config.summaries.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {config.summaries.map((summary) => {
            const value = reportData.summaries[summary.id] || 0;
            const colDef = availableColumns.find((c) => c.id === summary.column);
            const isCurrency = colDef?.format === 'currency';

            return (
              <Card key={summary.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {summary.label}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {isCurrency
                      ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
                      : new Intl.NumberFormat('en-US').format(value)}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Chart Preview */}
      {chartComputed && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MaterialIcon name="insights" size="md" />
              Chart
            </CardTitle>
            <CardDescription>
              {chartComputed.title}
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              {chartComputed.type === 'bar' ? (
                <BarChart data={chartComputed.data}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" hide />
                  <YAxis />
                  <Tooltip formatter={(v) => formatCellValue(v, chartComputed.metricFormat)} />
                  <Legend />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              ) : chartComputed.type === 'line' ? (
                <LineChart data={chartComputed.data}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip formatter={(v) => formatCellValue(v, chartComputed.metricFormat)} />
                  <Legend />
                  <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                </LineChart>
              ) : (
                <PieChart>
                  <Pie
                    data={chartComputed.data}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={120}
                    labelLine={false}
                    label={({ name, percent }) =>
                      `${String(name).slice(0, 14)} (${((percent || 0) * 100).toFixed(0)}%)`
                    }
                  >
                    {chartComputed.data.map((_, idx) => (
                      <Cell key={`cell-${idx}`} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => formatCellValue(v, chartComputed.metricFormat)} />
                  <Legend />
                </PieChart>
              )}
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Results Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MaterialIcon name="description" size="md" />
            Results
            {reportData && (
              <Badge variant="secondary" className="ml-2">
                {reportData.totalCount.toLocaleString()} rows
                {reportData.executionTime && ` • ${reportData.executionTime}ms`}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            {visibleColumns.length === 0
              ? 'Select columns above to build your report'
              : reportData
              ? `Showing ${Math.min(reportData.rows.length, config.limit || 1000)} of ${reportData.totalCount} records`
              : 'Click "Run Report" to execute the query'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {executing ? (
            <div className="flex items-center justify-center py-16">
              <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
            </div>
          ) : reportData && reportData.rows.length > 0 ? (
            <ScrollArea className="h-[500px]">
              <div className="border rounded-lg overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      {visibleColumns.map((col) => {
                        const colDef = availableColumns.find((c) => c.id === col.id);
                        const sortDef = config.orderBy.find((o) => o.column === col.id);

                        return (
                          <th
                            key={col.id}
                            className={`text-left p-3 border-b font-medium ${
                              colDef?.sortable ? 'cursor-pointer hover:bg-muted-foreground/10' : ''
                            } ${col.format === 'currency' || col.format === 'number' ? 'text-right' : ''}`}
                            onClick={() => colDef?.sortable && handleToggleSort(col.id)}
                          >
                            <div className="flex items-center gap-1">
                              <span>{col.label}</span>
                              {colDef?.sortable && (
                                <span className="text-muted-foreground">
                                  {sortDef ? (
                                    sortDef.direction === 'asc' ? (
                                      <MaterialIcon name="arrow_upward" style={{ fontSize: '12px' }} />
                                    ) : (
                                      <MaterialIcon name="arrow_downward" style={{ fontSize: '12px' }} />
                                    )
                                  ) : (
                                    <MaterialIcon name="swap_vert" style={{ fontSize: '12px' }} className="opacity-50" />
                                  )}
                                </span>
                              )}
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {reportData.rows.map((row, idx) => (
                      <tr key={String(row.id) || idx} className="border-b hover:bg-muted/50">
                        {visibleColumns.map((col) => {
                          const colDef = availableColumns.find((c) => c.id === col.id);
                          const value = row[col.id];

                          return (
                            <td
                              key={col.id}
                              className={`p-3 ${
                                col.format === 'currency' || col.format === 'number' ? 'text-right' : ''
                              }`}
                            >
                              {col.format === 'badge' && colDef?.badgeConfig ? (
                                <Badge variant={getBadgeVariant(col.id, value) as any}>
                                  {colDef.badgeConfig[String(value)]?.label || String(value || '-')}
                                </Badge>
                              ) : col.format === 'boolean' ? (
                                <Badge variant={value ? 'default' : 'outline'}>
                                  {value ? 'Yes' : 'No'}
                                </Badge>
                              ) : (
                                formatCellValue(value, col.format)
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ScrollArea>
          ) : reportData && reportData.rows.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              No data found matching your filters
            </div>
          ) : (
            <div className="text-center py-16 text-muted-foreground">
              {visibleColumns.length > 0
                ? 'Configure your report and click "Run Report" to see results'
                : 'Select at least one column to build your report'}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Save Dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{currentReport ? 'Update Report' : 'Save Report'}</DialogTitle>
            <DialogDescription>
              {currentReport
                ? 'Update the saved report with your changes'
                : 'Save this report configuration for later use'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="report-name">Report Name *</Label>
              <Input
                id="report-name"
                value={reportName}
                onChange={(e) => setReportName(e.target.value)}
                placeholder="e.g., Monthly Billing Summary"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="report-desc">Description</Label>
              <Textarea
                id="report-desc"
                value={reportDescription}
                onChange={(e) => setReportDescription(e.target.value)}
                placeholder="Optional description..."
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveReport}>
              <MaterialIcon name="save" size="sm" className="mr-2" />
              {currentReport ? 'Update' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Load Dialog */}
      <Dialog open={loadDialogOpen} onOpenChange={setLoadDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Load Saved Report</DialogTitle>
            <DialogDescription>
              Select a previously saved report to load
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="h-[400px] pr-4">
            {reportsLoading ? (
              <div className="flex items-center justify-center py-8">
                <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
              </div>
            ) : reports.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No saved reports yet. Create your first report!
              </div>
            ) : (
              <div className="space-y-2">
                {reports.map((report) => (
                  <div
                    key={report.id}
                    className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 cursor-pointer"
                    onClick={() => handleLoadReport(report)}
                  >
                    <div className="flex-1">
                      <div className="font-medium">{report.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {DATA_SOURCES[report.data_source]?.label} •{' '}
                        {new Date(report.updated_at).toLocaleDateString()}
                      </div>
                      {report.description && (
                        <div className="text-sm text-muted-foreground mt-1">
                          {report.description}
                        </div>
                      )}
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon">
                          <MaterialIcon name="more_vert" size="sm" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleLoadReport(report)}>
                          <MaterialIcon name="folder_open" size="sm" className="mr-2" />
                          Load
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteId(report.id);
                          }}
                          className="text-destructive"
                        >
                          <MaterialIcon name="delete" size="sm" className="mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={() => setLoadDialogOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!confirmDeleteId} onOpenChange={() => setConfirmDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Report</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this report? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmDeleteId && handleDeleteReport(confirmDeleteId)}
            >
              <MaterialIcon name="delete" size="sm" className="mr-2" />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
