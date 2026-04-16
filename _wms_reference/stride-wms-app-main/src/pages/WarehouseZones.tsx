import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useWarehouses } from '@/hooks/useWarehouses';
import { useWarehouseZones, WarehouseZone } from '@/hooks/useWarehouseZones';
import { useWarehouseZoneUsage } from '@/hooks/useWarehouseZoneUsage';

type ZoneDraft = Pick<WarehouseZone, 'zone_code' | 'description' | 'sort_order'>;

const DEFAULT_CREATE_DRAFT: ZoneDraft = {
  zone_code: '',
  description: '',
  sort_order: null,
};

export default function WarehouseZones() {
  const navigate = useNavigate();
  const { warehouseId } = useParams<{ warehouseId: string }>();
  const { toast } = useToast();

  const { warehouses } = useWarehouses();
  const warehouse = useMemo(
    () => warehouses.find((w) => w.id === warehouseId) || null,
    [warehouses, warehouseId]
  );

  const {
    zones,
    loading,
    createZone,
    updateZone,
    deleteZone,
    batchGenerateZones,
  } = useWarehouseZones(warehouseId);

  const {
    byZoneId: usageByZoneId,
    loading: usageLoading,
    refetch: refetchUsage,
  } = useWarehouseZoneUsage(warehouseId);

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [createDraft, setCreateDraft] = useState<ZoneDraft>(DEFAULT_CREATE_DRAFT);
  const [editZone, setEditZone] = useState<WarehouseZone | null>(null);
  const [editDraft, setEditDraft] = useState<ZoneDraft>(DEFAULT_CREATE_DRAFT);
  const [zoneToDelete, setZoneToDelete] = useState<WarehouseZone | null>(null);
  const deleteUsage = zoneToDelete ? usageByZoneId.get(zoneToDelete.id) : null;

  const [batchPrefix, setBatchPrefix] = useState('ZN-');
  const [batchStart, setBatchStart] = useState(1);
  const [batchCount, setBatchCount] = useState(50);
  const [batchPad, setBatchPad] = useState(3);

  const openEdit = (z: WarehouseZone) => {
    setEditZone(z);
    setEditDraft({
      zone_code: z.zone_code,
      description: z.description ?? '',
      sort_order: z.sort_order ?? null,
    });
    setEditOpen(true);
  };

  const openDelete = (z: WarehouseZone) => {
    setZoneToDelete(z);
    setDeleteOpen(true);
  };

  const handleCreate = async () => {
    if (!createDraft.zone_code.trim()) {
      toast({ variant: 'destructive', title: 'Zone Code required', description: 'Enter a zone code like ZN-001.' });
      return;
    }

    try {
      setSaving(true);
      await createZone({
        zone_code: createDraft.zone_code.trim(),
        description: createDraft.description?.trim() ? createDraft.description.trim() : null,
        sort_order: createDraft.sort_order ?? null,
      });
      setCreateOpen(false);
      setCreateDraft(DEFAULT_CREATE_DRAFT);
      refetchUsage();
      toast({ title: 'Zone created', description: 'Zone has been created.' });
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Create failed', description: 'Failed to create zone.' });
    } finally {
      setSaving(false);
    }
  };

  const handleEditSave = async () => {
    if (!editZone) return;
    if (!editDraft.zone_code.trim()) {
      toast({ variant: 'destructive', title: 'Zone Code required', description: 'Zone code cannot be empty.' });
      return;
    }

    try {
      setSaving(true);
      await updateZone(editZone.id, {
        zone_code: editDraft.zone_code.trim(),
        description: editDraft.description?.trim() ? editDraft.description.trim() : null,
        sort_order: editDraft.sort_order ?? null,
      });
      setEditOpen(false);
      setEditZone(null);
      refetchUsage();
      toast({ title: 'Zone updated', description: 'Zone has been saved.' });
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Save failed', description: 'Failed to update zone.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!zoneToDelete) return;
    try {
      setSaving(true);
      await deleteZone(zoneToDelete.id);
      refetchUsage();
      toast({ title: 'Zone deleted', description: `${zoneToDelete.zone_code} was deleted.` });
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Delete failed', description: 'Failed to delete zone.' });
    } finally {
      setSaving(false);
      setDeleteOpen(false);
      setZoneToDelete(null);
    }
  };

  const handleBatchGenerate = async () => {
    try {
      setSaving(true);
      await batchGenerateZones({
        prefix: batchPrefix,
        start: batchStart,
        count: batchCount,
        padLength: batchPad,
      });
      setBatchOpen(false);
      refetchUsage();
      toast({ title: 'Zones generated', description: `Created ${batchCount} zones.` });
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Generate failed', description: 'Failed to generate zones.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 pb-20">
        <div className="flex items-start justify-between gap-3">
          <PageHeader
            primaryText="Warehouse"
            accentText="Zones"
            description={warehouse ? `${warehouse.name} (${warehouse.code})` : 'Manage zone definitions for this warehouse.'}
          />
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => navigate(-1)}>
              <MaterialIcon name="arrow_back" size="sm" className="mr-2" />
              Back
            </Button>
            <Button variant="outline" onClick={() => setBatchOpen(true)}>
              <MaterialIcon name="auto_awesome" size="sm" className="mr-2" />
              Batch Generate
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <MaterialIcon name="add" size="sm" className="mr-2" />
              New Zone
            </Button>
          </div>
        </div>

        {!warehouseId ? (
          <Card>
            <CardContent className="py-8 text-muted-foreground">Missing warehouseId in route.</CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Zones</CardTitle>
              <CardDescription>
                {loading ? 'Loading…' : `${zones.length} zone${zones.length === 1 ? '' : 's'}`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {zones.length === 0 && !loading ? (
                <div className="py-10 text-center text-muted-foreground">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                    <MaterialIcon name="grid_on" />
                  </div>
                  <div className="font-medium text-foreground">No zones yet</div>
                  <div className="text-sm mt-1">Create zones like ZN-001, then assign locations to zones.</div>
                  <div className="mt-4 flex items-center justify-center gap-2">
                    <Button variant="outline" onClick={() => setBatchOpen(true)}>
                      Batch Generate
                    </Button>
                    <Button onClick={() => setCreateOpen(true)}>Create Zone</Button>
                  </div>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Zone Code</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="w-[120px] text-right">Locations</TableHead>
                      <TableHead className="w-[120px] text-right">Map Nodes</TableHead>
                      <TableHead className="w-[120px]">Sort</TableHead>
                      <TableHead className="w-[120px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {zones.map((z) => {
                      const usage = usageByZoneId.get(z.id);
                      const locationCount = usage?.location_count ?? 0;
                      const nodeCount = usage?.node_count ?? 0;

                      return (
                        <TableRow key={z.id}>
                          <TableCell className="font-mono text-sm">{z.zone_code}</TableCell>
                          <TableCell className="text-muted-foreground">{z.description || '—'}</TableCell>
                          <TableCell className="text-muted-foreground text-right">
                            {usageLoading ? '…' : locationCount}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-right">
                            {usageLoading ? '…' : nodeCount}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{z.sort_order ?? '—'}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Button size="sm" variant="outline" onClick={() => openEdit(z)}>
                                Edit
                              </Button>
                              <Button size="sm" variant="outline" className="text-destructive" onClick={() => openDelete(z)}>
                                Delete
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Zone</DialogTitle>
            <DialogDescription>Define a zone code (e.g. ZN-001) for grouping locations.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Zone Code *</Label>
              <Input
                value={createDraft.zone_code}
                onChange={(e) => setCreateDraft((d) => ({ ...d, zone_code: e.target.value }))}
                placeholder="ZN-001"
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                value={createDraft.description || ''}
                onChange={(e) => setCreateDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder="Optional description"
              />
            </div>
            <div className="space-y-2">
              <Label>Sort Order</Label>
              <Input
                type="number"
                value={createDraft.sort_order ?? ''}
                onChange={(e) => setCreateDraft((d) => ({ ...d, sort_order: e.target.value ? Number(e.target.value) : null }))}
                placeholder="Optional"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? 'Saving…' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Zone</DialogTitle>
            <DialogDescription>Update zone properties.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Zone Code *</Label>
              <Input
                value={editDraft.zone_code}
                onChange={(e) => setEditDraft((d) => ({ ...d, zone_code: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                value={editDraft.description || ''}
                onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Sort Order</Label>
              <Input
                type="number"
                value={editDraft.sort_order ?? ''}
                onChange={(e) => setEditDraft((d) => ({ ...d, sort_order: e.target.value ? Number(e.target.value) : null }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleEditSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch generate dialog */}
      <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Batch Generate Zones</DialogTitle>
            <DialogDescription>Create many zones quickly (e.g. ZN-001 → ZN-100).</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Prefix</Label>
              <Input value={batchPrefix} onChange={(e) => setBatchPrefix(e.target.value)} placeholder="ZN-" />
            </div>
            <div className="space-y-2">
              <Label>Pad Length</Label>
              <Input type="number" value={batchPad} onChange={(e) => setBatchPad(Number(e.target.value) || 0)} />
            </div>
            <div className="space-y-2">
              <Label>Start</Label>
              <Input type="number" value={batchStart} onChange={(e) => setBatchStart(Number(e.target.value) || 0)} />
            </div>
            <div className="space-y-2">
              <Label>Count</Label>
              <Input type="number" value={batchCount} onChange={(e) => setBatchCount(Number(e.target.value) || 0)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleBatchGenerate} disabled={saving}>
              {saving ? 'Generating…' : 'Generate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Zone</AlertDialogTitle>
            <AlertDialogDescription>
              Delete <strong>{zoneToDelete?.zone_code}</strong>? Assigned locations will be unassigned (zone cleared).
              <div className="mt-2 text-sm">
                Impact:{' '}
                {usageLoading ? (
                  <span className="text-muted-foreground">Loading…</span>
                ) : (
                  <span className="text-muted-foreground">
                    {deleteUsage?.location_count ?? 0} location{(deleteUsage?.location_count ?? 0) === 1 ? '' : 's'} unassigned •{' '}
                    {deleteUsage?.node_count ?? 0} map node{(deleteUsage?.node_count ?? 0) === 1 ? '' : 's'} unbound
                  </span>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteConfirm}
            >
              {saving ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}

