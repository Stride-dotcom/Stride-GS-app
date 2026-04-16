import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import ExcelJS from 'exceljs';
import { addAoaSheet, setColumnWidths, downloadWorkbook } from '@/lib/excelUtils';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusIndicator } from '@/components/ui/StatusIndicator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { CreateContainerDialog } from '@/components/containers/CreateContainerDialog';
import { PrintContainerLabelsDialog } from '@/components/containers/PrintContainerLabelsDialog';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useWarehouses } from '@/hooks/useWarehouses';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import type { ContainerLabelData } from '@/lib/labelGenerator';
import {
  CONTAINER_LIST_COLUMNS,
  type ContainerListColumnKey,
} from '@/lib/containerListColumns';

type ContainerRow = Database['public']['Tables']['containers']['Row'];

type ContainerListRow = ContainerRow & {
  warehouse?: { id: string; name: string } | null;
  location?: { id: string; code: string; name: string | null } | null;
};

type ContainerStatusFilter = 'all' | 'active' | 'closed' | 'archived';

export default function Containers() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { toast } = useToast();
  const { warehouses } = useWarehouses();

  const [loading, setLoading] = useState(true);
  const [containers, setContainers] = useState<ContainerListRow[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [warehouseFilterId, setWarehouseFilterId] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<ContainerStatusFilter>('active');
  const [refreshKey, setRefreshKey] = useState(0);

  const [createOpen, setCreateOpen] = useState(false);
  const [savingStatusId, setSavingStatusId] = useState<string | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [printContainers, setPrintContainers] = useState<ContainerLabelData[]>([]);

  // Choose a warehouse for creation:
  // - prefer current warehouse filter (if not "all")
  // - otherwise auto-use the only warehouse (if there's exactly one)
  const createWarehouseId = useMemo(() => {
    if (warehouseFilterId && warehouseFilterId !== 'all') return warehouseFilterId;
    if (warehouses.length === 1) return warehouses[0].id;
    return '';
  }, [warehouseFilterId, warehouses]);

  const fetchContainers = useCallback(async () => {
    if (!profile?.tenant_id) return;
    setLoading(true);
    try {
      let query = (supabase.from('containers') as any)
        .select(`
          *,
          warehouse:warehouses!containers_warehouse_id_fkey(id, name),
          location:locations!containers_location_id_fkey(id, code, name)
        `)
        .eq('tenant_id', profile.tenant_id)
        .is('deleted_at', null)
        .order('container_code');

      if (warehouseFilterId && warehouseFilterId !== 'all') {
        query = query.eq('warehouse_id', warehouseFilterId);
      }
      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      setContainers((data || []) as ContainerListRow[]);
    } catch (err: any) {
      console.error('[Containers] fetch error:', err);
      toast({
        variant: 'destructive',
        title: 'Could not load containers',
        description: err?.message || 'Please try again.',
      });
      setContainers([]);
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, statusFilter, toast, warehouseFilterId]);

  useEffect(() => {
    void fetchContainers();
  }, [fetchContainers, refreshKey]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return containers;

    return containers.filter((c) => {
      const hay = [
        c.container_code,
        c.container_type,
        c.status,
        c.warehouse?.name,
        c.location?.code,
        c.location?.name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return hay.includes(q);
    });
  }, [containers, searchQuery]);

  const visibleColumns = useMemo(() => CONTAINER_LIST_COLUMNS, []);

  const getContainerColumnExportValue = useCallback(
    (container: ContainerListRow, columnKey: ContainerListColumnKey): string | number => {
      switch (columnKey) {
        case 'container_code':
          return container.container_code || '';
        case 'container_type':
          return container.container_type || '';
        case 'status':
          return container.status || '';
        case 'warehouse':
          return container.warehouse?.name || '';
        case 'location':
          return container.location?.code || '';
        case 'footprint_cu_ft':
          return typeof container.footprint_cu_ft === 'number' && Number.isFinite(container.footprint_cu_ft)
            ? Number(container.footprint_cu_ft.toFixed(1))
            : '';
        default:
          return '';
      }
    },
    []
  );

  const handleDownloadTemplate = useCallback(async () => {
    const headerRow = visibleColumns.map((column) => column.label);
    const exampleRow = visibleColumns.map((column) => column.templateExample);
    const blankRow = visibleColumns.map(() => '');

    const workbook = new ExcelJS.Workbook();
    const worksheet = addAoaSheet(workbook, [headerRow, exampleRow, blankRow], 'Containers');
    setColumnWidths(worksheet, visibleColumns.map((column) => column.xlsxWidth ?? 18));

    await downloadWorkbook(workbook, 'containers-template.xlsx');
  }, [visibleColumns]);

  const handleExportContainers = useCallback(async () => {
    const headerRow = visibleColumns.map((column) => column.label);
    const dataRows = filtered.map((container) =>
      visibleColumns.map((column) => getContainerColumnExportValue(container, column.key))
    );

    const workbook = new ExcelJS.Workbook();
    const worksheet = addAoaSheet(workbook, [headerRow, ...dataRows], 'Containers');
    setColumnWidths(worksheet, visibleColumns.map((column) => column.xlsxWidth ?? 18));

    await downloadWorkbook(workbook, 'containers-export.xlsx');
  }, [filtered, getContainerColumnExportValue, visibleColumns]);

  const updateContainerStatus = async (containerId: string, nextStatus: 'active' | 'closed' | 'archived') => {
    if (!profile?.tenant_id) return;
    setSavingStatusId(containerId);
    try {
      const patch: Partial<ContainerRow> & { updated_at: string } = {
        status: nextStatus,
        // Keep legacy is_active broadly in sync for older queries.
        is_active: nextStatus !== 'archived',
        updated_at: new Date().toISOString(),
      };

      const { error } = await (supabase.from('containers') as any)
        .update(patch)
        .eq('tenant_id', profile.tenant_id)
        .eq('id', containerId);

      if (error) throw error;

      toast({ title: 'Container updated', description: `Status set to ${nextStatus}.` });
      setRefreshKey((k) => k + 1);
    } catch (err: any) {
      console.error('[Containers] status update error:', err);
      toast({
        variant: 'destructive',
        title: 'Could not update container',
        description: err?.message || 'Please try again.',
      });
    } finally {
      setSavingStatusId(null);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">Containers</h1>
            <p className="text-sm text-muted-foreground">
              Manage cartons, pallets, and other containers across the warehouse.
            </p>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setRefreshKey((k) => k + 1)} disabled={loading}>
              <MaterialIcon name="refresh" size="sm" className="mr-2" />
              Refresh
            </Button>
            <Button
              onClick={() => {
                if (!createWarehouseId) {
                  toast({
                    variant: 'destructive',
                    title: 'Select a warehouse',
                    description: 'Choose a warehouse filter before creating a container.',
                  });
                  return;
                }
                setCreateOpen(true);
              }}
            >
              <MaterialIcon name="add" size="sm" className="mr-2" />
              Create Container
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <CardTitle className="text-base flex items-center gap-2">
                <MaterialIcon name="all_inbox" size="sm" />
                Containers
                <span className="text-sm text-muted-foreground font-normal">
                  ({filtered.length})
                </span>
              </CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleDownloadTemplate}>
                  <MaterialIcon name="upload_file" size="sm" className="mr-2" />
                  Template
                </Button>
                <Button variant="outline" size="sm" onClick={handleExportContainers}>
                  <MaterialIcon name="download" size="sm" className="mr-2" />
                  Export
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-1">
                <Input
                  placeholder="Search code, type, location…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="md:col-span-1">
                <Select value={warehouseFilterId} onValueChange={setWarehouseFilterId}>
                  <SelectTrigger>
                    <SelectValue placeholder="All warehouses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All warehouses</SelectItem>
                    {warehouses.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-1">
                <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as ContainerStatusFilter)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                    <SelectItem value="all">All statuses</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {visibleColumns.map((column) => (
                      <TableHead key={column.key} className={column.tableHeadClassName}>
                        {column.label}
                      </TableHead>
                    ))}
                    <TableHead className="w-[56px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={visibleColumns.length + 1} className="py-8 text-center text-muted-foreground">
                        Loading containers…
                      </TableCell>
                    </TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={visibleColumns.length + 1} className="py-10 text-center text-muted-foreground">
                        No containers found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((c) => (
                      <TableRow key={c.id} className="hover:bg-muted/40">
                        {visibleColumns.map((column) => {
                          if (column.key === 'container_code') {
                            return (
                              <TableCell
                                key={`${c.id}-${column.key}`}
                                className={column.tableCellClassName || 'font-mono font-medium'}
                              >
                                <Link to={`/containers/${c.id}`} className="hover:underline">
                                  {c.container_code}
                                </Link>
                              </TableCell>
                            );
                          }
                          if (column.key === 'container_type') {
                            return (
                              <TableCell key={`${c.id}-${column.key}`} className={column.tableCellClassName}>
                                {c.container_type || '—'}
                              </TableCell>
                            );
                          }
                          if (column.key === 'status') {
                            return (
                              <TableCell key={`${c.id}-${column.key}`} className={column.tableCellClassName}>
                                <StatusIndicator status={c.status || 'default'} size="sm" />
                              </TableCell>
                            );
                          }
                          if (column.key === 'warehouse') {
                            return (
                              <TableCell key={`${c.id}-${column.key}`} className={column.tableCellClassName}>
                                {c.warehouse?.name || '—'}
                              </TableCell>
                            );
                          }
                          if (column.key === 'location') {
                            return (
                              <TableCell key={`${c.id}-${column.key}`} className={column.tableCellClassName}>
                                {c.location?.id ? (
                                  <Link to={`/locations/${c.location.id}`} className="hover:underline">
                                    {c.location.code}
                                  </Link>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </TableCell>
                            );
                          }
                          if (column.key === 'footprint_cu_ft') {
                            return (
                              <TableCell key={`${c.id}-${column.key}`} className={column.tableCellClassName}>
                                {typeof c.footprint_cu_ft === 'number' && Number.isFinite(c.footprint_cu_ft)
                                  ? `${c.footprint_cu_ft.toFixed(1)} cu ft`
                                  : '—'}
                              </TableCell>
                            );
                          }
                          return (
                            <TableCell key={`${c.id}-${column.key}`} className={column.tableCellClassName}>
                              —
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" aria-label="Container actions">
                                <MaterialIcon name="more_vert" size="sm" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => navigate(`/containers/${c.id}`)}>
                                <MaterialIcon name="open_in_new" size="sm" className="mr-2" />
                                Open
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  setPrintContainers([
                                    {
                                      id: c.id,
                                      containerCode: c.container_code,
                                      containerType: c.container_type,
                                      warehouseName: c.warehouse?.name || null,
                                      locationCode: c.location?.code || null,
                                    },
                                  ]);
                                  setPrintOpen(true);
                                }}
                              >
                                <MaterialIcon name="print" size="sm" className="mr-2" />
                                Print label
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {c.status === 'active' && (
                                <DropdownMenuItem
                                  disabled={savingStatusId === c.id}
                                  onClick={() => updateContainerStatus(c.id, 'closed')}
                                >
                                  <MaterialIcon name="lock" size="sm" className="mr-2" />
                                  Close
                                </DropdownMenuItem>
                              )}
                              {c.status === 'closed' && (
                                <DropdownMenuItem
                                  disabled={savingStatusId === c.id}
                                  onClick={() => updateContainerStatus(c.id, 'active')}
                                >
                                  <MaterialIcon name="lock_open" size="sm" className="mr-2" />
                                  Reopen
                                </DropdownMenuItem>
                              )}
                              {c.status !== 'archived' && (
                                <DropdownMenuItem
                                  disabled={savingStatusId === c.id}
                                  onClick={() => updateContainerStatus(c.id, 'archived')}
                                >
                                  <MaterialIcon name="archive" size="sm" className="mr-2" />
                                  Archive
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <CreateContainerDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          warehouseId={createWarehouseId}
          onSuccess={() => setRefreshKey((k) => k + 1)}
        />

        <PrintContainerLabelsDialog
          open={printOpen}
          onOpenChange={setPrintOpen}
          containers={printContainers}
        />
      </div>
    </DashboardLayout>
  );
}

