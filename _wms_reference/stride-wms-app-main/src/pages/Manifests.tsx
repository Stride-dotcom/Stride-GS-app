import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  MobileDataCard,
  MobileDataCardHeader,
  MobileDataCardTitle,
  MobileDataCardContent,
  MobileDataCardActions,
} from '@/components/ui/mobile-data-card';
import { CreateManifestDialog } from '@/components/manifests/CreateManifestDialog';
import { useManifests, ManifestStatus, CreateManifestData } from '@/hooks/useManifests';
import { useWarehouses } from '@/hooks/useWarehouses';
import { useSelectedWarehouse } from '@/contexts/WarehouseContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { StatusIndicator } from '@/components/ui/StatusIndicator';
import { format } from 'date-fns';

const statusLabels: Record<ManifestStatus, string> = {
  draft: 'Draft',
  active: 'Ready',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export default function Manifests() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<ManifestStatus | 'all'>('all');
  const [warehouseFilter, setWarehouseFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    type: 'start' | 'complete' | 'cancel' | 'delete';
    id: string;
    name: string;
  } | null>(null);

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
  const {
    manifests,
    loading,
    refetch,
    createManifest,
    startManifest,
    completeManifest,
    cancelManifest,
    deleteManifest,
  } = useManifests({
    status: statusFilter === 'all' ? undefined : statusFilter,
    warehouseId: warehouseFilter === 'all' ? undefined : warehouseFilter,
  });

  const filteredManifests = manifests.filter((m) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      m.manifest_number.toLowerCase().includes(query) ||
      m.name?.toLowerCase().includes(query) ||
      m.warehouse?.name?.toLowerCase().includes(query)
    );
  });

  const handleCreateManifest = async (data: CreateManifestData) => {
    const result = await createManifest(data);
    // Navigate to the manifest detail page to add items
    if (result?.id) {
      navigate(`/manifests/${result.id}`);
    }
  };

  const handleConfirmAction = async () => {
    if (!confirmAction) return;

    try {
      switch (confirmAction.type) {
        case 'start':
          await startManifest(confirmAction.id);
          break;
        case 'complete':
          await completeManifest(confirmAction.id);
          break;
        case 'cancel':
          await cancelManifest(confirmAction.id);
          break;
        case 'delete':
          await deleteManifest(confirmAction.id);
          break;
      }
    } finally {
      setConfirmAction(null);
    }
  };

  const getStatusBadge = (status: string) => (
    <StatusIndicator status={status} label={statusLabels[status as ManifestStatus]} size="sm" />
  );

  const getProgressDisplay = (scanned: number, expected: number) => {
    const percent = expected > 0 ? Math.round((scanned / expected) * 100) : 0;
    return (
      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span>{scanned} / {expected}</span>
          <span>{percent}%</span>
        </div>
        <Progress value={percent} className="h-2" />
      </div>
    );
  };

  const stats = {
    draft: manifests.filter((m) => m.status === 'draft').length,
    active: manifests.filter((m) => m.status === 'active' || m.status === 'in_progress').length,
    completed: manifests.filter((m) => m.status === 'completed').length,
    total: manifests.length,
  };

  return (
    <DashboardLayout>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <MaterialIcon name="arrow_back" size="sm" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              <span className="text-foreground">Manifest</span>{' '}
              <span className="text-primary">Lists</span>
            </h1>
            <p className="text-muted-foreground">Pre-defined item lists for targeted stocktake</p>
          </div>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <MaterialIcon name="add" size="sm" className="mr-2" />
          New Manifest
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card className="bg-blue-500/10 border-blue-500/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Draft</p>
                <p className="text-2xl font-bold text-blue-400">{stats.draft}</p>
              </div>
              <MaterialIcon name="edit_document" size="xl" className="text-blue-400/50" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-yellow-500/10 border-yellow-500/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active</p>
                <p className="text-2xl font-bold text-yellow-400">{stats.active}</p>
              </div>
              <MaterialIcon name="play_arrow" size="xl" className="text-yellow-400/50" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-green-500/10 border-green-500/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Completed</p>
                <p className="text-2xl font-bold text-green-400">{stats.completed}</p>
              </div>
              <MaterialIcon name="check_circle" size="xl" className="text-green-400/50" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-primary/10 border-primary/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-2xl font-bold text-primary">{stats.total}</p>
              </div>
              <MaterialIcon name="assignment" size="xl" className="text-primary/50" />
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
                placeholder="Search manifests..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as ManifestStatus | 'all')}
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

      {/* Manifests List */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <MaterialIcon name="progress_activity" size="xl" className="animate-spin text-muted-foreground" />
            </div>
          ) : filteredManifests.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <MaterialIcon name="assignment" className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No manifests found</p>
              <Button variant="link" onClick={() => setCreateDialogOpen(true)}>
                Create your first manifest
              </Button>
            </div>
          ) : isMobile ? (
            <div className="divide-y divide-border">
              {filteredManifests.map((m) => (
                <MobileDataCard key={m.id}>
                  <MobileDataCardHeader>
                    <MobileDataCardTitle className="flex items-center gap-2">
                      {m.name || m.manifest_number}
                      {m.billable && (
                        <MaterialIcon name="attach_money" size="sm" className="text-green-500" />
                      )}
                    </MobileDataCardTitle>
                    {getStatusBadge(m.status)}
                  </MobileDataCardHeader>
                  <MobileDataCardContent>
                    <div className="space-y-2 text-muted-foreground">
                      <div>
                        <span className="font-medium">Number:</span> {m.manifest_number}
                      </div>
                      <div>
                        <span className="font-medium">Warehouse:</span>{' '}
                        {m.warehouse?.name || 'Unknown'}
                      </div>
                      <div className="pt-2">
                        <span className="font-medium text-foreground">Progress:</span>
                        {getProgressDisplay(m.scanned_item_count, m.expected_item_count)}
                      </div>
                      {m.completed_at && (
                        <div>
                          <span className="font-medium">Completed:</span>{' '}
                          {format(new Date(m.completed_at), 'MMM d, yyyy h:mm a')}
                        </div>
                      )}
                    </div>
                  </MobileDataCardContent>
                  <MobileDataCardActions>
                    {m.status === 'draft' && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => navigate(`/manifests/${m.id}`)}
                        >
                          <MaterialIcon name="edit" size="sm" className="mr-1" /> Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setConfirmAction({ type: 'start', id: m.id, name: m.manifest_number })
                          }
                        >
                          <MaterialIcon name="play_arrow" size="sm" className="mr-1" /> Start
                        </Button>
                      </>
                    )}
                    {(m.status === 'active' || m.status === 'in_progress') && (
                      <>
                        <Button size="sm" onClick={() => navigate(`/manifests/${m.id}/scan`)}>
                          <MaterialIcon name="qr_code_scanner" size="sm" className="mr-1" /> Scan
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setConfirmAction({ type: 'complete', id: m.id, name: m.manifest_number })
                          }
                        >
                          <MaterialIcon name="check_circle" size="sm" className="mr-1" /> Complete
                        </Button>
                      </>
                    )}
                    {m.status === 'completed' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(`/manifests/${m.id}`)}
                      >
                        <MaterialIcon name="visibility" size="sm" className="mr-1" /> View
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
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[200px]">Progress</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredManifests.map((m) => (
                  <TableRow
                    key={m.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/manifests/${m.id}`)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div>
                          <div className="font-medium flex items-center gap-2">
                            {m.name || m.manifest_number}
                            {m.billable && (
                              <MaterialIcon name="attach_money" size="sm" className="text-green-500" />
                            )}
                          </div>
                          {m.name && (
                            <div className="text-xs text-muted-foreground font-mono">
                              {m.manifest_number}
                            </div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{m.warehouse?.name || '-'}</TableCell>
                    <TableCell>{getStatusBadge(m.status)}</TableCell>
                    <TableCell>
                      {getProgressDisplay(m.scanned_item_count, m.expected_item_count)}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {format(new Date(m.created_at), 'MMM d, yyyy')}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {m.created_by_user?.first_name} {m.created_by_user?.last_name}
                      </div>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="ghost">
                            <MaterialIcon name="more_vert" size="sm" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => navigate(`/manifests/${m.id}`)}>
                            <MaterialIcon name="visibility" size="sm" className="mr-2" />
                            View Details
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => navigate(`/manifests/${m.id}/history`)}>
                            <MaterialIcon name="timeline" size="sm" className="mr-2" />
                            Activity
                          </DropdownMenuItem>
                          {m.status === 'draft' && (
                            <>
                              <DropdownMenuItem
                                onClick={() =>
                                  setConfirmAction({ type: 'start', id: m.id, name: m.manifest_number })
                                }
                              >
                                <MaterialIcon name="play_arrow" size="sm" className="mr-2" />
                                Start
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() =>
                                  setConfirmAction({ type: 'delete', id: m.id, name: m.manifest_number })
                                }
                              >
                                <MaterialIcon name="delete" size="sm" className="mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </>
                          )}
                          {(m.status === 'active' || m.status === 'in_progress') && (
                            <>
                              <DropdownMenuItem onClick={() => navigate(`/manifests/${m.id}/scan`)}>
                                <MaterialIcon name="qr_code_scanner" size="sm" className="mr-2" />
                                Scan Items
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  setConfirmAction({ type: 'complete', id: m.id, name: m.manifest_number })
                                }
                              >
                                <MaterialIcon name="check_circle" size="sm" className="mr-2" />
                                Complete
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() =>
                                  setConfirmAction({ type: 'cancel', id: m.id, name: m.manifest_number })
                                }
                              >
                                <MaterialIcon name="cancel" size="sm" className="mr-2" />
                                Cancel
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create Manifest Dialog */}
      <CreateManifestDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSubmit={handleCreateManifest}
      />

      {/* Confirmation Dialog */}
      <AlertDialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction?.type === 'start' && 'Start Manifest?'}
              {confirmAction?.type === 'complete' && 'Complete Manifest?'}
              {confirmAction?.type === 'cancel' && 'Cancel Manifest?'}
              {confirmAction?.type === 'delete' && 'Delete Manifest?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.type === 'start' && (
                <>
                  This will activate the manifest <strong>{confirmAction.name}</strong> for scanning.
                  Make sure all items have been added to the manifest.
                </>
              )}
              {confirmAction?.type === 'complete' && (
                <>
                  This will mark the manifest <strong>{confirmAction.name}</strong> as completed.
                  Any unscanned items will remain in the report.
                </>
              )}
              {confirmAction?.type === 'cancel' && (
                <>
                  This will cancel the manifest <strong>{confirmAction.name}</strong>. This action
                  cannot be undone.
                </>
              )}
              {confirmAction?.type === 'delete' && (
                <>
                  This will permanently delete the manifest <strong>{confirmAction.name}</strong>.
                  This action cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmAction}
              className={confirmAction?.type === 'delete' ? 'bg-destructive hover:bg-destructive/90' : ''}
            >
              {confirmAction?.type === 'start' && 'Start'}
              {confirmAction?.type === 'complete' && 'Complete'}
              {confirmAction?.type === 'cancel' && 'Cancel Manifest'}
              {confirmAction?.type === 'delete' && 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
