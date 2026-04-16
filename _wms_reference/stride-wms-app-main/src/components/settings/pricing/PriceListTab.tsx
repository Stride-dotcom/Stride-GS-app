import { useState, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import ExcelJS from 'exceljs';
import { addAoaSheet, downloadWorkbook } from '@/lib/excelUtils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { ActiveBadge } from '@/components/ui/active-badge';
import { useChargeTypesWithRules, useChargeTypes, usePricingRules, type ChargeTypeWithRules } from '@/hooks/useChargeTypes';
import { useClasses } from '@/hooks/useClasses';
import { useServiceCategories } from '@/hooks/useServiceCategories';
import { AddServiceForm } from './AddServiceForm';
import { ServiceRateImportDialog } from './ServiceRateImportDialog';
import { cn } from '@/lib/utils';

interface PriceListTabProps {
  navigateToTab: (tab: string) => void;
}

type ViewMode = 'list' | 'matrix';
type StatusFilter = 'all' | 'active' | 'inactive';

const EXPORT_STATIC_HEADERS = [
  'charge_code', 'charge_name', 'category', 'is_active', 'is_taxable',
  'default_trigger', 'input_mode', 'add_to_scan', 'add_flag',
  'flag_is_indicator', 'alert_rule', 'notes',
  'pricing_method', 'unit', 'rate', 'minimum_charge', 'service_time_minutes',
];

export function PriceListTab({ navigateToTab }: PriceListTabProps) {
  const { chargeTypesWithRules, loading, refetch } = useChargeTypesWithRules();
  const { deleteChargeType } = useChargeTypes();
  const { classes } = useClasses();
  const { activeCategories } = useServiceCategories();
  const { toast } = useToast();

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingChargeType, setEditingChargeType] = useState<ChargeTypeWithRules | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<ChargeTypeWithRules | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [showImport, setShowImport] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    return chargeTypesWithRules.filter((ct) => {
      const matchesSearch = !search ||
        ct.charge_code.toLowerCase().includes(search.toLowerCase()) ||
        ct.charge_name.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = categoryFilter === 'all' || ct.category === categoryFilter;
      const matchesStatus = statusFilter === 'all' ||
        (statusFilter === 'active' && ct.is_active) ||
        (statusFilter === 'inactive' && !ct.is_active);
      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [chargeTypesWithRules, search, categoryFilter, statusFilter]);

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    await deleteChargeType(deleteConfirm.id);
    setDeleteConfirm(null);
    refetch();
  };

  const handleEdit = (ct: ChargeTypeWithRules) => {
    setEditingChargeType(ct);
    setShowAddForm(true);
  };

  const handleDuplicate = (ct: ChargeTypeWithRules) => {
    const dup = {
      ...ct,
      id: '',
      charge_code: ct.charge_code + '-COPY',
      charge_name: ct.charge_name + ' (Copy)',
    };
    setEditingChargeType(dup as ChargeTypeWithRules);
    setShowAddForm(true);
  };

  const classCodes = useMemo(() => classes.map(c => c.code), [classes]);

  const buildHeaders = () => {
    const headers = [...EXPORT_STATIC_HEADERS];
    classes.forEach(c => headers.push(`Rate: ${c.code}`));
    return headers;
  };

  const boolStr = (v: boolean) => v ? 'Yes' : 'No';

  const buildRow = (ct: ChargeTypeWithRules) => {
    const isClassBased = ct.pricing_rules.some(r => r.pricing_method === 'class_based');
    const flatRule = ct.pricing_rules.find(r => !r.class_code);
    const anyRule = ct.pricing_rules[0];

    const row: unknown[] = [
      ct.charge_code, ct.charge_name, ct.category,
      boolStr(ct.is_active), boolStr(ct.is_taxable),
      ct.default_trigger, ct.input_mode,
      boolStr(ct.add_to_scan), boolStr(ct.add_flag),
      boolStr(ct.flag_is_indicator), ct.alert_rule || '', ct.notes || '',
      isClassBased ? 'class_based' : 'flat',
      anyRule?.unit || 'each',
      !isClassBased ? (flatRule?.rate?.toFixed(2) || '') : '',
      anyRule?.minimum_charge?.toFixed(2) || '',
      anyRule?.service_time_minutes?.toString() || '',
    ];

    classes.forEach(cls => {
      const rule = ct.pricing_rules.find(r => r.class_code === cls.code);
      row.push(rule ? rule.rate.toFixed(2) : '');
    });

    return row;
  };

  const handleExport = async () => {
    const wb = new ExcelJS.Workbook();
    const headers = buildHeaders();
    const rows = filtered.map(buildRow);
    addAoaSheet(wb, [headers, ...rows], 'Price List');
    await downloadWorkbook(wb, 'price-list-export.xlsx');
    toast({ title: 'Exported', description: `${filtered.length} services exported to Excel.` });
  };

  const handleDownloadTemplate = async () => {
    const wb = new ExcelJS.Workbook();
    const headers = buildHeaders();
    const exampleRow = [
      'SVC-001', 'Example Service', 'handling', 'Yes', 'No',
      'manual', 'qty', 'No', 'No', 'No', 'none', '',
      'flat', 'each', '25.00', '', '',
      ...classes.map(() => ''),
    ];
    addAoaSheet(wb, [headers, exampleRow], 'Template');

    // Instructions sheet
    const instructions = [
      ['Field', 'Description', 'Valid Values'],
      ['charge_code', 'Unique service code (required)', 'Any text'],
      ['charge_name', 'Service display name (required)', 'Any text'],
      ['category', 'Service category', 'receiving, storage, handling, task, shipping, service'],
      ['is_active', 'Whether service is active', 'Yes / No'],
      ['is_taxable', 'Whether service is taxable', 'Yes / No'],
      ['default_trigger', 'Auto trigger type', 'manual, task, shipment, storage, auto'],
      ['input_mode', 'Input mode', 'qty, time, both'],
      ['add_to_scan', 'Show on scan screen', 'Yes / No'],
      ['add_flag', 'Add as item flag', 'Yes / No'],
      ['flag_is_indicator', 'Flag is indicator only', 'Yes / No'],
      ['alert_rule', 'Alert rule', 'none, or custom rule'],
      ['notes', 'Internal notes', 'Any text'],
      ['pricing_method', 'Pricing method', 'flat, class_based'],
      ['unit', 'Billing unit', 'each, per_item, per_task, per_hour, per_minute, per_day, per_month'],
      ['rate', 'Flat rate (if flat pricing)', 'Number'],
      ['minimum_charge', 'Minimum charge amount', 'Number'],
      ['service_time_minutes', 'Default service time in minutes', 'Number'],
      ...classes.map(c => [`Rate: ${c.code}`, `Rate for class ${c.name}`, 'Number']),
    ];
    addAoaSheet(wb, instructions, 'Instructions');
    await downloadWorkbook(wb, 'service-rates-template.xlsx');
    toast({ title: 'Template downloaded' });
  };

  const handleImportFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImportFile(file);
      setShowImport(true);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  if (showAddForm) {
    return (
      <AddServiceForm
        onClose={() => {
          setShowAddForm(false);
          setEditingChargeType(null);
        }}
        onSaved={() => {
          refetch();
          setShowAddForm(false);
          setEditingChargeType(null);
        }}
        editingChargeType={editingChargeType}
        navigateToTab={navigateToTab}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (chargeTypesWithRules.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <MaterialIcon name="payments" size="xl" className="text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-2">No services configured</h3>
        <p className="text-muted-foreground mb-6 max-w-sm">
          Add your first service to start billing, or use Quick Start to load a template.
        </p>
        <div className="flex gap-3">
          <Button onClick={() => setShowAddForm(true)}>
            <MaterialIcon name="add" size="sm" className="mr-1.5" />
            Add Service
          </Button>
          <Button variant="outline" onClick={() => navigateToTab('quick-start')}>
            <MaterialIcon name="rocket_launch" size="sm" className="mr-1.5" />
            Go to Quick Start
          </Button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleImportFileSelect}
          />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <MaterialIcon name="more_vert" size="sm" className="mr-1.5" />
                Actions
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleExport}>
                <MaterialIcon name="download" size="sm" className="mr-2" />
                Export to Excel
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleDownloadTemplate}>
                <MaterialIcon name="description" size="sm" className="mr-2" />
                Download Template
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                <MaterialIcon name="upload" size="sm" className="mr-2" />
                Import from File
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Import dialog */}
        <ServiceRateImportDialog
          open={showImport}
          onOpenChange={setShowImport}
          file={importFile}
          onSuccess={refetch}
          classCodes={classCodes}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="relative flex-1 w-full sm:max-w-xs">
          <MaterialIcon name="search" size="sm" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search services..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>

        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-[160px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {activeCategories.map((cat) => (
              <SelectItem key={cat.id} value={cat.name.toLowerCase()}>
                {cat.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-full sm:w-[130px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>

        {/* View toggle */}
        <div className="flex border rounded-md overflow-hidden">
          <button
            className={cn(
              'px-3 py-1.5 text-sm transition-colors',
              viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'
            )}
            onClick={() => setViewMode('list')}
          >
            <MaterialIcon name="view_list" size="sm" />
          </button>
          <button
            className={cn(
              'px-3 py-1.5 text-sm transition-colors',
              viewMode === 'matrix' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'
            )}
            onClick={() => setViewMode('matrix')}
          >
            <MaterialIcon name="grid_view" size="sm" />
          </button>
        </div>

        {/* Import / Export / Template */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={handleImportFileSelect}
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="w-full sm:w-auto justify-center sm:justify-start">
              <MaterialIcon name="more_vert" size="sm" className="mr-1.5" />
              Actions
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleExport}>
              <MaterialIcon name="download" size="sm" className="mr-2" />
              Export to Excel
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleDownloadTemplate}>
              <MaterialIcon name="description" size="sm" className="mr-2" />
              Download Template
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
              <MaterialIcon name="upload" size="sm" className="mr-2" />
              Import from File
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button onClick={() => setShowAddForm(true)} className="w-full sm:w-auto">
          <MaterialIcon name="add" size="sm" className="mr-1.5" />
          Add Service
        </Button>
      </div>

      {/* Results count */}
      <p className="text-xs text-muted-foreground">
        {filtered.length} of {chargeTypesWithRules.length} services
      </p>

      {/* List or Matrix view */}
      {viewMode === 'list' ? (
        <ListView
          items={filtered}
          classes={classes}
          onEdit={handleEdit}
          onDuplicate={handleDuplicate}
          onDelete={setDeleteConfirm}
        />
      ) : (
        <MatrixView
          items={filtered}
          classes={classes}
          onEdit={handleEdit}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Service?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteConfirm?.charge_name}"?
              This action cannot be undone. Historical billing data will be preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Import dialog */}
      <ServiceRateImportDialog
        open={showImport}
        onOpenChange={setShowImport}
        file={importFile}
        onSuccess={refetch}
        classCodes={classCodes}
      />
    </div>
  );
}

// =============================================================================
// LIST VIEW — Clickable rows that navigate to full edit form
// =============================================================================

interface ListViewProps {
  items: ChargeTypeWithRules[];
  classes: ReturnType<typeof useClasses>['classes'];
  onEdit: (ct: ChargeTypeWithRules) => void;
  onDuplicate: (ct: ChargeTypeWithRules) => void;
  onDelete: (ct: ChargeTypeWithRules) => void;
}

function ListView({ items, classes, onEdit, onDuplicate, onDelete }: ListViewProps) {
  const getPricingMethodLabel = (ct: ChargeTypeWithRules) => {
    const hasClassRules = ct.pricing_rules.some(r => r.pricing_method === 'class_based');
    return hasClassRules ? 'Class-Based' : 'Flat';
  };

  const getRateDisplay = (ct: ChargeTypeWithRules) => {
    if (ct.pricing_rules.length === 0) return 'No rates';
    const rates = ct.pricing_rules.map(r => r.rate).filter(Boolean);
    if (rates.length === 0) return 'No rates';
    const min = Math.min(...rates);
    const max = Math.max(...rates);
    if (min === max) return `$${min.toFixed(2)}`;
    return `$${min.toFixed(2)} – $${max.toFixed(2)}`;
  };

  return (
    <div className="space-y-2">
      {items.map((ct) => (
        <Card
          key={ct.id}
          className={cn(
            'group cursor-pointer transition-colors hover:bg-muted/50',
            !ct.is_active && 'opacity-60'
          )}
          onClick={() => onEdit(ct)}
        >
          <CardContent className="flex items-center gap-3 py-3 px-4">
            <Badge variant="outline" className="font-mono text-xs shrink-0">
              {ct.charge_code}
            </Badge>
            <div className="flex-1 min-w-0">
              <span className="font-medium text-sm truncate block">{ct.charge_name}</span>
            </div>
            <div className="hidden sm:flex items-center gap-1.5 shrink-0">
              {ct.category && (
                <Badge variant="secondary" className="text-xs capitalize">
                  {ct.category}
                </Badge>
              )}
              <Badge variant="outline" className="text-xs">
                {getPricingMethodLabel(ct)}
              </Badge>
              {ct.add_to_scan && (
                <Badge variant="outline" className="text-xs">Scan</Badge>
              )}
              {ct.add_flag && (
                <Badge variant="outline" className="text-xs">Flag</Badge>
              )}
              {ct.is_taxable && (
                <Badge variant="outline" className="text-xs">Tax</Badge>
              )}
              <span className="text-sm text-muted-foreground ml-1">
                {getRateDisplay(ct)}
              </span>
            </div>
            <ActiveBadge active={ct.is_active} className="shrink-0" />
            {/* Action buttons — visible on hover */}
            <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={(e) => { e.stopPropagation(); onDuplicate(ct); }}
                    >
                      <MaterialIcon name="content_copy" size="sm" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Duplicate</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={(e) => { e.stopPropagation(); onDelete(ct); }}
                    >
                      <MaterialIcon name="delete" size="sm" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Delete</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <MaterialIcon name="chevron_right" size="sm" className="text-muted-foreground shrink-0" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// =============================================================================
// MATRIX VIEW
// =============================================================================

interface MatrixViewProps {
  items: ChargeTypeWithRules[];
  classes: ReturnType<typeof useClasses>['classes'];
  onEdit: (ct: ChargeTypeWithRules) => void;
}

function MatrixView({ items, classes, onEdit }: MatrixViewProps) {
  const getTriggerLabel = (trigger: string) => {
    const map: Record<string, string> = {
      manual: 'Manual',
      task: 'Task',
      shipment: 'Ship',
      storage: 'Storage',
      auto: 'Auto',
    };
    return map[trigger] || trigger;
  };

  const getCompoundTriggerLabel = (ct: ChargeTypeWithRules) => {
    const parts: string[] = [getTriggerLabel(ct.default_trigger)];
    if (ct.add_flag) parts.push('Flag');
    if (ct.add_to_scan) parts.push('Scan');
    return parts.join(' + ');
  };

  return (
    <div className="border rounded-lg overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 bg-background z-10 min-w-[200px]">Service</TableHead>
            <TableHead className="text-center w-20">Auto Trigger</TableHead>
            {classes.map((cls) => (
              <TableHead key={cls.id} className="text-center min-w-[80px]">
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger className="font-mono text-xs">
                      {cls.code}
                    </TooltipTrigger>
                    <TooltipContent>{cls.name}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </TableHead>
            ))}
            <TableHead className="text-center min-w-[80px]">Min</TableHead>
            <TableHead className="text-center min-w-[80px]">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((ct) => (
            <TableRow
              key={ct.id}
              className={cn('cursor-pointer hover:bg-muted/50', !ct.is_active && 'opacity-50')}
              onClick={() => onEdit(ct)}
            >
              <TableCell className="sticky left-0 bg-background z-10">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono text-xs shrink-0">{ct.charge_code}</Badge>
                  <span className="text-sm truncate">{ct.charge_name}</span>
                </div>
              </TableCell>
              <TableCell className="text-center">
                <div className="flex items-center justify-center gap-1 flex-wrap">
                  <Badge variant="secondary" className="text-xs">{getTriggerLabel(ct.default_trigger)}</Badge>
                  {ct.add_flag && <Badge variant="outline" className="text-[10px] px-1">Flag</Badge>}
                  {ct.add_to_scan && <Badge variant="outline" className="text-[10px] px-1">Scan</Badge>}
                </div>
              </TableCell>
              {classes.map((cls) => {
                const rule = ct.pricing_rules.find(r => r.class_code === cls.code);
                return (
                  <TableCell key={cls.id} className="text-center">
                    {rule ? (
                      <div>
                        <span className="text-sm font-medium">${rule.rate.toFixed(2)}</span>
                        {rule.service_time_minutes && (
                          <div className="text-[10px] text-muted-foreground">{rule.service_time_minutes}m</div>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                );
              })}
              <TableCell className="text-center">
                {ct.pricing_rules.find(r => r.minimum_charge) ? (
                  <span className="text-sm">${ct.pricing_rules.find(r => r.minimum_charge)?.minimum_charge?.toFixed(2)}</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-center">
                <ActiveBadge active={ct.is_active} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
