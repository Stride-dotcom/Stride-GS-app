import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  MobileDataCard,
  MobileDataCardHeader,
  MobileDataCardTitle,
  MobileDataCardContent,
  MobileDataCardActions,
} from '@/components/ui/mobile-data-card';
import { CreateStocktakeDialog } from '@/components/stocktakes/CreateStocktakeDialog';
import { useStocktakes, StocktakeStatus, CreateStocktakeData } from '@/hooks/useStocktakes';
import { useWarehouses } from '@/hooks/useWarehouses';
import { useSelectedWarehouse } from '@/contexts/WarehouseContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { format } from 'date-fns';
import { HelpButton } from '@/components/prompts';
import { SOPValidationDialog, SOPBlocker } from '@/components/common/SOPValidationDialog';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { StatusIndicator } from '@/components/ui/StatusIndicator';
import { useAuth } from '@/contexts/AuthContext';
import { formatMinutesShort } from '@/lib/time/serviceTimeEstimate';
import { promptResumePausedTask } from '@/lib/time/promptResumePausedTask';
import { resolveActiveJobLabel } from '@/lib/time/resolveActiveJobLabel';

const statusLabels: Record<StocktakeStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

export default function Stocktakes() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [statusFilter, setStatusFilter] = useState<StocktakeStatus | 'all'>('all');
  const [warehouseFilter, setWarehouseFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    type: 'start' | 'close' | 'cancel';
    id: string;
    name: string;
  } | null>(null);
  const [sopValidationOpen, setSopValidationOpen] = useState(false);
  const [sopBlockers, setSopBlockers] = useState<SOPBlocker[]>([]);
  const [startSwitchOpen, setStartSwitchOpen] = useState(false);
  const [startSwitchLoading, setStartSwitchLoading] = useState(false);
  const [startSwitchStocktakeId, setStartSwitchStocktakeId] = useState<string | null>(null);
  const [activeJobLabel, setActiveJobLabel] = useState<string | null>(null);

  const { toast } = useToast();

  const isMobile = useIsMobile();
  const { warehouses } = useWarehouses();
  const { selectedWarehouseId } = useSelectedWarehouse();

  // If this tenant only has one warehouse, default filters to it once.
  // (Keep the selector visible; user can still switch back to "All" if desired.)
  const didAutoDefaultWarehouseFilter = useRef(false);
  useEffect(() => {
    if (didAutoDefaultWarehouseFilter.current) return;
    if (warehouses.length !== 1) return;
    if (warehouseFilter !== 'all') return;

    didAutoDefaultWarehouseFilter.current = true;
    setWarehouseFilter(selectedWarehouseId || warehouses[0].id);
  }, [warehouses, warehouseFilter, selectedWarehouseId]);

  // Reset auto-default ref when warehouses list changes
  useEffect(() => {
    didAutoDefaultWarehouseFilter.current = false;
  }, [warehouses.length]);
  const {
    stocktakes,
    loading,
    refetch,
    createStocktake,
    startStocktakeDetailed,
    closeStocktake,
    cancelStocktake,
  } = useStocktakes({
    status: statusFilter === 'all' ? undefined : statusFilter,
    warehouseId: warehouseFilter === 'all' ? undefined : warehouseFilter,
  });

  const filteredStocktakes = stocktakes.filter((st) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      st.stocktake_number.toLowerCase().includes(query) ||
      st.name?.toLowerCase().includes(query) ||
      st.warehouse?.name?.toLowerCase().includes(query)
    );
  });

  const handleCreateStocktake = async (data: CreateStocktakeData) => {
    await createStocktake(data);
  };

  const handleConfirmAction = async () => {
    if (!confirmAction) return;

    try {
      // For 'close' action, call SOP validator first
      if (confirmAction.type === 'close') {
        const { data: validationResult, error: rpcError } = await (supabase as any).rpc(
          'validate_stocktake_completion',
          { p_stocktake_id: confirmAction.id }
        );

        if (rpcError) {
          console.error('Validation RPC error:', rpcError);
          toast({
            variant: 'destructive',
            title: 'Validation Error',
            description: 'Failed to validate stocktake completion. Please try again.',
          });
          return;
        }

        const result = validationResult as { ok: boolean; blockers: SOPBlocker[] };
        const blockers = (result?.blockers || []).filter(
          (b: SOPBlocker) => b.severity === 'blocking' || !b.severity
        );

        if (!result?.ok && blockers.length > 0) {
          setSopBlockers(result.blockers);
          setSopValidationOpen(true);
          setConfirmAction(null);
          return;
        }
      }

      switch (confirmAction.type) {
        case 'start': {
          const res = await startStocktakeDetailed(confirmAction.id, { pauseExisting: false });
          if ((res as any)?.ok === false) {
            if ((res as any)?.error_code === 'ACTIVE_TIMER_EXISTS') {
              setStartSwitchStocktakeId(confirmAction.id);
              let label: string;
              try {
                label = await resolveActiveJobLabel(profile?.tenant_id, (res as any)?.active_job_type, (res as any)?.active_job_id) ?? 'an active job';
              } catch {
                label = 'an active job';
              }
              setActiveJobLabel(label);
              setStartSwitchOpen(true);
              return;
            }
            throw new Error((res as any)?.error_message || 'Failed to start stocktake');
          }

          navigate(`/stocktakes/${confirmAction.id}/scan`);
          break;
        }
        case 'close':
          await closeStocktake(confirmAction.id);
          promptResumePausedTask();
          break;
        case 'cancel':
          await cancelStocktake(confirmAction.id);
          break;
      }
    } catch (err: any) {
      console.error('[Stocktakes] action failed:', err);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err?.message || 'Action failed',
      });
    } finally {
      setConfirmAction(null);
    }
  };

  const getStatusBadge = (status: string) => (
    <StatusIndicator status={status} label={statusLabels[status as StocktakeStatus]} size="sm" />
  );

  const getVarianceBadge = (variance: number | null) => {
    if (variance === null || variance === 0) return null;
    return (
      <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
        <MaterialIcon name="warning" className="h-3 w-3 mr-1" />
        {variance} variance{variance !== 1 ? 's' : ''}
      </Badge>
    );
  };

  const stats = {
    draft: stocktakes.filter((s) => s.status === 'draft').length,
    active: stocktakes.filter((s) => s.status === 'active').length,
    closed: stocktakes.filter((s) => s.status === 'closed').length,
    withVariance: stocktakes.filter((s) => s.variance_count && s.variance_count > 0).length,
  };

  return (
    <DashboardLayout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="text-foreground">Cycle</span>{' '}
            <span className="text-primary">Count</span>
          </h1>
          <p className="text-muted-foreground">Schedule and manage inventory cycle counts</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate('/manifests')}>
            <MaterialIcon name="assignment_turned_in" size="sm" className="mr-2" />
            Manifests
          </Button>
          <Button onClick={() => setCreateDialogOpen(true)}>
            <MaterialIcon name="add" size="sm" className="mr-2" />
            New Stocktake
          </Button>
          <HelpButton workflow="stocktake" />
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card className="bg-card border border-border shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Draft</p>
                <p className="text-2xl font-bold text-blue-500 dark:text-blue-400">{stats.draft}</p>
              </div>
              <span className="text-3xl opacity-50">📄</span>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border border-border shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active</p>
                <p className="text-2xl font-bold text-yellow-500 dark:text-yellow-400">{stats.active}</p>
              </div>
              <span className="text-3xl opacity-50">📋</span>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border border-border shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Closed</p>
                <p className="text-2xl font-bold text-green-500 dark:text-green-400">{stats.closed}</p>
              </div>
              <span className="text-3xl opacity-50">✅</span>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border border-border shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">With Variance</p>
                <p className="text-2xl font-bold text-red-500 dark:text-red-400">{stats.withVariance}</p>
              </div>
              <span className="text-3xl opacity-50">⚠️</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <MaterialIcon name="search" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search stocktakes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as StocktakeStatus | 'all')}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {Object.entries(statusLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={warehouseFilter} onValueChange={setWarehouseFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Warehouse" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Warehouses</SelectItem>
                {warehouses.map((wh) => (
                  <SelectItem key={wh.id} value={wh.id}>
                    {wh.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => refetch()}>
              <MaterialIcon name="refresh" size="sm" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Stocktakes List */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <MaterialIcon name="progress_activity" size="xl" className="animate-spin text-muted-foreground" />
            </div>
          ) : filteredStocktakes.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <MaterialIcon name="assignment_turned_in" className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No stocktakes found</p>
              <Button variant="link" onClick={() => setCreateDialogOpen(true)}>
                Create your first stocktake
              </Button>
            </div>
          ) : isMobile ? (
            <div className="divide-y divide-border">
              {filteredStocktakes.map((st) => (
                <MobileDataCard key={st.id}>
                  <MobileDataCardHeader>
                    <MobileDataCardTitle className="flex items-center gap-2">
                      {st.name || st.stocktake_number}
                      {st.freeze_moves && (
                        <MaterialIcon name="lock" size="sm" className="text-yellow-500" />
                      )}
                      {st.allow_location_auto_fix && (
                        <MaterialIcon name="build" size="sm" className="text-blue-500" />
                      )}
                      {st.billable && (
                        <MaterialIcon name="attach_money" size="sm" className="text-green-500" />
                      )}
                    </MobileDataCardTitle>
                    {getStatusBadge(st.status)}
                  </MobileDataCardHeader>
                  <MobileDataCardContent>
                    <div className="space-y-1 text-muted-foreground">
                      <div>
                        <span className="font-medium">Number:</span> {st.stocktake_number}
                      </div>
                      <div>
                        <span className="font-medium">Warehouse:</span>{' '}
                        {st.warehouse?.name || 'Unknown'}
                      </div>
                      <div>
                        <span className="font-medium">Locations:</span>{' '}
                        {st.location_ids ? `${(st.location_ids as string[]).length} selected` : 'All'}
                      </div>
                      <div>
                        <span className="font-medium">Items:</span> {st.counted_item_count || 0} /{' '}
                        {st.expected_item_count || 0}
                      </div>
                      <div>
                        <span className="font-medium">Actual Time:</span>{' '}
                        {st.duration_minutes != null && st.duration_minutes > 0
                          ? formatMinutesShort(st.duration_minutes)
                          : '-'}
                      </div>
                      {st.closed_at && (
                        <div>
                          <span className="font-medium">Closed:</span>{' '}
                          {format(new Date(st.closed_at), 'MMM d, yyyy h:mm a')}
                        </div>
                      )}
                      {st.variance_count !== null && st.variance_count > 0 && (
                        <div>{getVarianceBadge(st.variance_count)}</div>
                      )}
                    </div>
                  </MobileDataCardContent>
                  <MobileDataCardActions>
                    {st.status === 'draft' && (
                      <>
                        <Button
                          size="sm"
                          onClick={() =>
                            setConfirmAction({ type: 'start', id: st.id, name: st.stocktake_number })
                          }
                        >
                          <MaterialIcon name="play_arrow" size="sm" className="mr-1" /> Start
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setConfirmAction({ type: 'cancel', id: st.id, name: st.stocktake_number })
                          }
                        >
                          Cancel
                        </Button>
                      </>
                    )}
                    {st.status === 'active' && (
                      <>
                        <Button size="sm" onClick={() => navigate(`/stocktakes/${st.id}/scan`)}>
                          <MaterialIcon name="qr_code_scanner" size="sm" className="mr-1" /> Scan
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setConfirmAction({ type: 'close', id: st.id, name: st.stocktake_number })
                          }
                        >
                          <MaterialIcon name="check_circle" size="sm" className="mr-1" /> Close
                        </Button>
                      </>
                    )}
                    {st.status === 'closed' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(`/stocktakes/${st.id}/report`)}
                      >
                        <MaterialIcon name="insert_chart" size="sm" className="mr-1" /> Report
                      </Button>
                    )}
                  </MobileDataCardActions>
                </MobileDataCard>
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name / Number</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead>Locations</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Actual Time</TableHead>
                  <TableHead>Variance</TableHead>
                  <TableHead>Options</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredStocktakes.map((st) => (
                  <TableRow
                    key={st.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/stocktakes/${st.id}/scan`)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div>
                          <div className="font-medium">{st.name || st.stocktake_number}</div>
                          {st.name && (
                            <div className="text-xs text-muted-foreground font-mono">
                              {st.stocktake_number}
                            </div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{st.warehouse?.name || '-'}</TableCell>
                    <TableCell>
                      {st.location_ids
                        ? `${(st.location_ids as string[]).length} locations`
                        : 'All'}
                    </TableCell>
                    <TableCell>{getStatusBadge(st.status)}</TableCell>
                    <TableCell>
                      {st.counted_item_count || 0} / {st.expected_item_count || 0}
                    </TableCell>
                    <TableCell>
                      {st.duration_minutes != null && st.duration_minutes > 0 ? (
                        <span className="tabular-nums whitespace-nowrap">
                          {formatMinutesShort(st.duration_minutes)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>{getVarianceBadge(st.variance_count)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {st.freeze_moves && (
                          <MaterialIcon name="lock" size="sm" className="text-yellow-500" />
                        )}
                        {st.allow_location_auto_fix && (
                          <MaterialIcon name="build" size="sm" className="text-blue-500" />
                        )}
                        {st.billable && (
                          <MaterialIcon name="attach_money" size="sm" className="text-green-500" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-2">
                        {st.status === 'draft' && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setConfirmAction({
                                  type: 'start',
                                  id: st.id,
                                  name: st.stocktake_number,
                                })
                              }
                              title="Start stocktake"
                            >
                              <MaterialIcon name="play_arrow" size="sm" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setConfirmAction({
                                  type: 'cancel',
                                  id: st.id,
                                  name: st.stocktake_number,
                                })
                              }
                              title="Cancel stocktake"
                            >
                              <MaterialIcon name="cancel" size="sm" />
                            </Button>
                          </>
                        )}
                        {st.status === 'active' && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => navigate(`/stocktakes/${st.id}/scan`)}
                              title="Scan items"
                            >
                              <MaterialIcon name="qr_code_scanner" size="sm" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setConfirmAction({
                                  type: 'close',
                                  id: st.id,
                                  name: st.stocktake_number,
                                })
                              }
                              title="Close stocktake"
                            >
                              <MaterialIcon name="check_circle" size="sm" />
                            </Button>
                          </>
                        )}
                        {st.status === 'closed' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => navigate(`/stocktakes/${st.id}/report`)}
                            title="View report"
                          >
                            <MaterialIcon name="insert_chart" size="sm" />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => navigate(`/stocktakes/${st.id}/scan`)}
                          title="View details"
                        >
                          <MaterialIcon name="visibility" size="sm" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create Stocktake Dialog */}
      <CreateStocktakeDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSubmit={handleCreateStocktake}
      />

      {/* Confirmation Dialog */}
      <AlertDialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction?.type === 'start' && 'Start Stocktake?'}
              {confirmAction?.type === 'close' && 'Close Stocktake?'}
              {confirmAction?.type === 'cancel' && 'Cancel Stocktake?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.type === 'start' && (
                <>
                  This will initialize the expected items list and activate the stocktake{' '}
                  <strong>{confirmAction.name}</strong>. You can then start scanning items.
                </>
              )}
              {confirmAction?.type === 'close' && (
                <>
                  This will finalize the stocktake <strong>{confirmAction.name}</strong> and
                  generate the variance report. Any unscanned items will be marked as missing.
                </>
              )}
              {confirmAction?.type === 'cancel' && (
                <>
                  This will cancel the stocktake <strong>{confirmAction.name}</strong>. This action
                  cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmAction}>
              {confirmAction?.type === 'start' && 'Start'}
              {confirmAction?.type === 'close' && 'Close'}
              {confirmAction?.type === 'cancel' && 'Cancel Stocktake'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Start stocktake: pause existing job confirmation */}
      <AlertDialog open={startSwitchOpen} onOpenChange={setStartSwitchOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pause current job?</AlertDialogTitle>
            <AlertDialogDescription>
              It looks like you already have a job in progress{activeJobLabel ? ` (${activeJobLabel})` : ''}.
              Do you want to pause it and start this stocktake?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setActiveJobLabel(null);
                setStartSwitchStocktakeId(null);
              }}
              disabled={startSwitchLoading}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={async (e) => {
                e.preventDefault();
                if (!startSwitchStocktakeId) return;
                setStartSwitchLoading(true);
                try {
                  const res = await startStocktakeDetailed(startSwitchStocktakeId, { pauseExisting: true });
                  if ((res as any)?.ok === false) {
                    toast({
                      variant: 'destructive',
                      title: 'Unable to start stocktake',
                      description: (res as any)?.error_message || 'Failed to start stocktake',
                    });
                    return;
                  }

                  setStartSwitchOpen(false);
                  setActiveJobLabel(null);
                  const id = startSwitchStocktakeId;
                  setStartSwitchStocktakeId(null);
                  navigate(`/stocktakes/${id}/scan`);
                } finally {
                  setStartSwitchLoading(false);
                }
              }}
              disabled={startSwitchLoading}
            >
              Pause & Start
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* SOP Validation Dialog */}
      <SOPValidationDialog
        open={sopValidationOpen}
        onOpenChange={setSopValidationOpen}
        blockers={sopBlockers}
      />
    </DashboardLayout>
  );
}
