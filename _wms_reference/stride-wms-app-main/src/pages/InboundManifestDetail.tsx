import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { HelpTip } from '@/components/ui/help-tip';
import { ShipmentNumberBadge } from '@/components/shipments/ShipmentNumberBadge';
import { isValidUuid } from '@/lib/utils';
import { useInboundManifestDetail, type ManifestItem } from '@/hooks/useInboundManifestDetail';
import { useExternalRefs, type RefType } from '@/hooks/useExternalRefs';
import { useAllocation } from '@/hooks/useAllocation';
import { useClasses } from '@/hooks/useClasses';
import { logActivity } from '@/lib/activity/logActivity';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import AllocationPicker from '@/components/incoming/AllocationPicker';
import ManifestImportDialog from '@/components/incoming/ManifestImportDialog';
import { EntityActivityFeed } from '@/components/activity/EntityActivityFeed';

function formatDate(d: string | null | undefined): string {
  if (!d) return '-';
  return new Date(d).toLocaleDateString();
}

function allocationSummary(item: ManifestItem): string {
  const allocated = item.allocated_qty ?? 0;
  const expected = item.expected_quantity ?? 0;
  if (allocated === 0) return 'Unallocated';
  if (allocated >= expected) return 'Fully allocated';
  return `${allocated}/${expected}`;
}

function allocationBadgeVariant(item: ManifestItem): 'default' | 'secondary' | 'outline' {
  const allocated = item.allocated_qty ?? 0;
  const expected = item.expected_quantity ?? 0;
  if (allocated >= expected) return 'default';
  if (allocated > 0) return 'secondary';
  return 'outline';
}

export default function InboundManifestDetail() {
  const { id } = useParams<{ id: string }>();

  if (!id || !isValidUuid(id)) {
    return <Navigate to="/incoming" replace />;
  }

  const navigate = useNavigate();
  const { profile } = useAuth();
  const { toast } = useToast();
  const { manifest, items, refs: manifestRefs, loading, refetch } = useInboundManifestDetail(id);
  const { refs, addRef, removeRef } = useExternalRefs(id);
  const { deallocate, loading: deallocating } = useAllocation();
  const { classes, loading: classesLoading } = useClasses();

  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [showAllocationPicker, setShowAllocationPicker] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showAddItemDialog, setShowAddItemDialog] = useState(false);
  const [itemRows, setItemRows] = useState<ManifestItem[]>([]);
  const [newRefType, setNewRefType] = useState<RefType>('BOL');
  const [newRefValue, setNewRefValue] = useState('');

  // Editable header fields
  const [editingHeader, setEditingHeader] = useState(false);
  const [headerVendor, setHeaderVendor] = useState('');
  const [headerEtaStart, setHeaderEtaStart] = useState('');
  const [headerEtaEnd, setHeaderEtaEnd] = useState('');
  const [headerPieces, setHeaderPieces] = useState('');
  const [headerSaving, setHeaderSaving] = useState(false);

  // Add item form
  const [addItemDesc, setAddItemDesc] = useState('');
  const [addItemVendor, setAddItemVendor] = useState('');
  const [addItemSidemark, setAddItemSidemark] = useState('');
  const [addItemRoom, setAddItemRoom] = useState('');
  const [addItemQty, setAddItemQty] = useState('1');
  const [addItemNotes, setAddItemNotes] = useState('');
  const [addingItem, setAddingItem] = useState(false);

  useEffect(() => {
    setItemRows(items);
  }, [items]);

  const unallocatedItems = useMemo(
    () => itemRows.filter((i) => (i.allocated_qty ?? 0) < (i.expected_quantity ?? 0)),
    [itemRows]
  );

  const selectedForAllocation = useMemo(
    () => itemRows.filter((i) => selectedItems.has(i.id)),
    [itemRows, selectedItems]
  );

  const toggleItem = (itemId: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedItems.size === unallocatedItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(unallocatedItems.map((i) => i.id)));
    }
  };

  const updateLocalItem = (itemId: string, field: string, value: unknown) => {
    setItemRows((prev) =>
      prev.map((item) => (item.id === itemId ? ({ ...item, [field]: value } as ManifestItem) : item))
    );
  };

  const persistItemPatch = async (itemId: string, patch: Record<string, unknown>) => {
    const { error } = await (supabase.from('shipment_items') as any)
      .update(patch)
      .eq('id', itemId);

    if (error) throw error;
  };

  const handleDuplicateItem = async (item: ManifestItem) => {
    try {
      const { error } = await (supabase.from('shipment_items') as any).insert({
        shipment_id: id,
        expected_description: item.expected_description || null,
        expected_vendor: item.expected_vendor || null,
        expected_sidemark: item.expected_sidemark || null,
        expected_class_id: item.expected_class_id || null,
        room: item.room || null,
        expected_quantity: item.expected_quantity || 1,
        notes: item.notes || null,
        status: 'pending',
      });

      if (error) throw error;

      if (profile?.tenant_id && profile?.id && id) {
        void logActivity({
          entityType: 'shipment',
          tenantId: profile.tenant_id,
          entityId: id,
          actorUserId: profile.id,
          eventType: 'item_added',
          eventLabel: `Manifest item duplicated: ${item.expected_description || 'Item'}`,
          details: {
            expected_description: item.expected_description || null,
            expected_vendor: item.expected_vendor || null,
            expected_sidemark: item.expected_sidemark || null,
            expected_quantity: item.expected_quantity || 1,
          },
        });
      }

      toast({ title: 'Item Duplicated' });
      refetch();
    } catch (err: unknown) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to duplicate item',
      });
    }
  };

  const handleRemoveItem = async (item: ManifestItem) => {
    if (item.allocations.length > 0) {
      toast({
        variant: 'destructive',
        title: 'Item is allocated',
        description: 'Deallocate this item before removing it from the manifest.',
      });
      return;
    }

    try {
      const { error } = await (supabase.from('shipment_items') as any)
        .delete()
        .eq('id', item.id);

      if (error) throw error;

      if (profile?.tenant_id && profile?.id && id) {
        void logActivity({
          entityType: 'shipment',
          tenantId: profile.tenant_id,
          entityId: id,
          actorUserId: profile.id,
          eventType: 'item_removed',
          eventLabel: 'Manifest item removed',
          details: { shipment_item_id: item.id },
        });
      }

      setSelectedItems((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });

      toast({ title: 'Item Removed' });
      refetch();
    } catch (err: unknown) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to remove item',
      });
    }
  };

  const handleAddRef = async () => {
    if (!newRefValue.trim()) return;
    await addRef(newRefType, newRefValue);
    setNewRefValue('');
  };

  const handleDeallocate = async (allocationId: string) => {
    const result = await deallocate(allocationId);
    if (result?.success) {
      refetch();
    }
  };

  const handleAllocationComplete = () => {
    setShowAllocationPicker(false);
    setSelectedItems(new Set());
    refetch();
  };

  const handleImportComplete = () => {
    setShowImportDialog(false);
    refetch();
  };

  const handleEditHeader = () => {
    if (!manifest) return;
    setHeaderVendor(manifest.vendor_name || '');
    setHeaderEtaStart(manifest.eta_start ? String(manifest.eta_start).split('T')[0] : '');
    setHeaderEtaEnd(manifest.eta_end ? String(manifest.eta_end).split('T')[0] : '');
    setHeaderPieces(manifest.expected_pieces?.toString() || '');
    setEditingHeader(true);
  };

  const handleSaveHeader = async () => {
    if (!manifest) return;
    try {
      setHeaderSaving(true);
      const { error } = await supabase
        .from('shipments')
        .update({
          vendor_name: headerVendor || null,
          eta_start: headerEtaStart || null,
          eta_end: headerEtaEnd || null,
          expected_pieces: headerPieces ? Number(headerPieces) : null,
        } as Record<string, unknown>)
        .eq('id', manifest.id);
      if (error) throw error;
      toast({ title: 'Manifest Updated' });
      setEditingHeader(false);
      refetch();
    } catch (err: unknown) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to update manifest',
      });
    } finally {
      setHeaderSaving(false);
    }
  };

  const handleAddItem = async () => {
    if (!profile?.tenant_id || !id) return;
    try {
      setAddingItem(true);
      const { error } = await (supabase as any)
        .from('shipment_items')
        .insert({
          shipment_id: id,
          expected_description: addItemDesc || null,
          expected_vendor: addItemVendor || null,
          expected_sidemark: addItemSidemark || null,
          room: addItemRoom || null,
          expected_quantity: Number(addItemQty) || 1,
          notes: addItemNotes || null,
        });
      if (error) throw error;
      toast({ title: 'Item Added' });
      setShowAddItemDialog(false);
      setAddItemDesc('');
      setAddItemVendor('');
      setAddItemSidemark('');
      setAddItemRoom('');
      setAddItemQty('1');
      setAddItemNotes('');
      refetch();
    } catch (err: unknown) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to add item',
      });
    } finally {
      setAddingItem(false);
    }
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-24">
          <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  if (!manifest) {
    return (
      <DashboardLayout>
        <div className="text-center py-24 text-muted-foreground">
          <MaterialIcon name="error_outline" size="xl" className="mb-2 opacity-40" />
          <p>Manifest not found.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/incoming')}>
            Back to Incoming Manager
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  if (showAllocationPicker && selectedForAllocation.length > 0) {
    return (
      <AllocationPicker
        manifestShipmentId={id}
        manifestItems={selectedForAllocation}
        onComplete={handleAllocationComplete}
        onCancel={() => setShowAllocationPicker(false)}
      />
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/incoming')}>
            <MaterialIcon name="arrow_back" size="sm" className="mr-1" />
            Back
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <MaterialIcon name="list_alt" size="md" />
              <ShipmentNumberBadge shipmentNumber={manifest.shipment_number} exceptionType={(manifest as any).shipment_exception_type} className="text-2xl" />
              <Badge variant="secondary">{manifest.inbound_status || 'draft'}</Badge>
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              {manifest.account_name && <span>{manifest.account_name} &middot; </span>}
              {manifest.vendor_name && <span>Vendor: {manifest.vendor_name} &middot; </span>}
              {manifest.expected_pieces != null && <span>{manifest.expected_pieces} pieces &middot; </span>}
              Created {formatDate(manifest.created_at)}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={handleEditHeader}>
              <MaterialIcon name="edit" size="sm" className="mr-1" />
              Edit Details
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowImportDialog(true)}>
              <MaterialIcon name="upload_file" size="sm" className="mr-1" />
              Import Items
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowAddItemDialog(true)}>
              <MaterialIcon name="add" size="sm" className="mr-1" />
              Add Item
            </Button>
          </div>
        </div>

        {/* Edit Header Panel */}
        {editingHeader && (
          <Card className="border-primary/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Edit Manifest Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">Vendor Name</Label>
                  <Input
                    value={headerVendor}
                    onChange={(e) => setHeaderVendor(e.target.value)}
                    placeholder="Enter vendor..."
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">ETA Start</Label>
                  <Input
                    type="date"
                    value={headerEtaStart}
                    onChange={(e) => setHeaderEtaStart(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">ETA End</Label>
                  <Input
                    type="date"
                    value={headerEtaEnd}
                    onChange={(e) => setHeaderEtaEnd(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Expected Pieces</Label>
                  <Input
                    type="number"
                    value={headerPieces}
                    onChange={(e) => setHeaderPieces(e.target.value)}
                    placeholder="0"
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <Button size="sm" onClick={handleSaveHeader} disabled={headerSaving}>
                  {headerSaving ? 'Saving...' : 'Save'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditingHeader(false)}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ETA + Pieces info cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">ETA Start</div>
              <div className="font-medium">{formatDate(manifest.eta_start)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">ETA End</div>
              <div className="font-medium">{formatDate(manifest.eta_end)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">Expected Pieces</div>
              <div className="font-medium">{manifest.expected_pieces ?? '-'}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">Items</div>
              <div className="font-medium">{itemRows.length}</div>
            </CardContent>
          </Card>
        </div>

        {/* External References */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              External References
              <HelpTip
                tooltip="BOL, PRO, tracking numbers, POs. Used for matching dock intakes to manifests and expected shipments."
                pageKey="incoming.manifest_detail"
                fieldKey="external_refs"
              />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2 mb-3">
              {(refs.length > 0 ? refs : manifestRefs).map((ref) => (
                <Badge key={ref.id} variant="outline" className="gap-1 pl-2 pr-1 py-1">
                  <span className="text-xs font-semibold">{ref.ref_type}:</span>
                  <span className="text-xs">{ref.value}</span>
                  <button
                    onClick={() => removeRef(ref.id)}
                    className="ml-1 hover:text-destructive"
                  >
                    <MaterialIcon name="close" size="sm" />
                  </button>
                </Badge>
              ))}
              {refs.length === 0 && manifestRefs.length === 0 && (
                <span className="text-sm text-muted-foreground">No references yet.</span>
              )}
            </div>
            <div className="flex gap-2 items-center">
              <Select value={newRefType} onValueChange={(v) => setNewRefType(v as RefType)}>
                <SelectTrigger className="w-[100px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BOL">BOL</SelectItem>
                  <SelectItem value="PRO">PRO</SelectItem>
                  <SelectItem value="TRACKING">Tracking</SelectItem>
                  <SelectItem value="PO">PO</SelectItem>
                  <SelectItem value="REF">REF</SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder="Enter reference value..."
                value={newRefValue}
                onChange={(e) => setNewRefValue(e.target.value)}
                className="max-w-xs"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddRef();
                }}
              />
              <Button size="sm" onClick={handleAddRef} disabled={!newRefValue.trim()}>
                Add
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Items Grid */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                Manifest Items
                <HelpTip
                  tooltip="Items on this manifest. Select items and click 'Allocate' to assign them to an expected shipment."
                  pageKey="incoming.manifest_detail"
                  fieldKey="manifest_items"
                />
              </CardTitle>
              <div className="flex gap-2">
                {selectedItems.size > 0 && (
                  <Button size="sm" onClick={() => setShowAllocationPicker(true)}>
                    <MaterialIcon name="link" size="sm" className="mr-1" />
                    Allocate {selectedItems.size} Item{selectedItems.size > 1 ? 's' : ''}
                  </Button>
                )}
              </div>
            </div>
            {itemRows.length > 0 && (
              <CardDescription>
                {itemRows.length} items &middot; {unallocatedItems.length} unallocated
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {itemRows.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <MaterialIcon name="inventory_2" size="xl" className="mb-2 opacity-40" />
                <p>No items yet. Import items from a spreadsheet or add them manually.</p>
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <input
                          type="checkbox"
                          checked={selectedItems.size === unallocatedItems.length && unallocatedItems.length > 0}
                          onChange={toggleAll}
                          className="rounded border-muted-foreground"
                        />
                      </TableHead>
                      <TableHead className="w-24 text-right">Qty</TableHead>
                      <TableHead className="w-40">Vendor</TableHead>
                      <TableHead className="min-w-[220px]">Description</TableHead>
                      <TableHead className="w-44">Class</TableHead>
                      <TableHead className="w-40">Side Mark</TableHead>
                      <TableHead className="w-36">Room</TableHead>
                      <TableHead className="w-52">Allocation</TableHead>
                      <TableHead className="w-28 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {itemRows.map((item) => {
                      const isFullyAllocated = (item.allocated_qty ?? 0) >= (item.expected_quantity ?? 0);
                      return (
                        <TableRow key={item.id} className={isFullyAllocated ? 'opacity-60' : ''}>
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={selectedItems.has(item.id)}
                              onChange={() => toggleItem(item.id)}
                              disabled={isFullyAllocated}
                              className="rounded border-muted-foreground"
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min={1}
                              value={item.expected_quantity ?? 1}
                              onChange={(e) => updateLocalItem(item.id, 'expected_quantity', Number(e.target.value) || 1)}
                              onBlur={async () => {
                                try {
                                  await persistItemPatch(item.id, {
                                    expected_quantity: item.expected_quantity || 1,
                                  });
                                } catch (err: unknown) {
                                  toast({
                                    variant: 'destructive',
                                    title: 'Failed to save quantity',
                                    description: err instanceof Error ? err.message : 'Could not save item quantity.',
                                  });
                                  refetch();
                                }
                              }}
                              className="h-8 text-right"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={item.expected_vendor || ''}
                              onChange={(e) => updateLocalItem(item.id, 'expected_vendor', e.target.value)}
                              onBlur={async () => {
                                try {
                                  await persistItemPatch(item.id, {
                                    expected_vendor: item.expected_vendor || null,
                                  });
                                } catch (err: unknown) {
                                  toast({
                                    variant: 'destructive',
                                    title: 'Failed to save vendor',
                                    description: err instanceof Error ? err.message : 'Could not save item vendor.',
                                  });
                                  refetch();
                                }
                              }}
                              placeholder="Vendor"
                              className="h-8"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={item.expected_description || ''}
                              onChange={(e) => updateLocalItem(item.id, 'expected_description', e.target.value)}
                              onBlur={async () => {
                                try {
                                  await persistItemPatch(item.id, {
                                    expected_description: item.expected_description || null,
                                  });
                                } catch (err: unknown) {
                                  toast({
                                    variant: 'destructive',
                                    title: 'Failed to save description',
                                    description: err instanceof Error ? err.message : 'Could not save item description.',
                                  });
                                  refetch();
                                }
                              }}
                              placeholder="Description"
                              className="h-8"
                            />
                          </TableCell>
                          <TableCell>
                            <Select
                              value={item.expected_class_id || '__none__'}
                              onValueChange={async (value) => {
                                const classId = value === '__none__' ? null : value;
                                updateLocalItem(item.id, 'expected_class_id', classId);
                                try {
                                  await persistItemPatch(item.id, { expected_class_id: classId });
                                } catch (err: unknown) {
                                  toast({
                                    variant: 'destructive',
                                    title: 'Failed to save class',
                                    description: err instanceof Error ? err.message : 'Could not save item class.',
                                  });
                                  refetch();
                                }
                              }}
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue placeholder={classesLoading ? 'Loading...' : 'Select class'} />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">No class</SelectItem>
                                {classes.map((cls) => (
                                  <SelectItem key={cls.id} value={cls.id}>
                                    {cls.code} - {cls.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Input
                              value={item.expected_sidemark || ''}
                              onChange={(e) => updateLocalItem(item.id, 'expected_sidemark', e.target.value)}
                              onBlur={async () => {
                                try {
                                  await persistItemPatch(item.id, {
                                    expected_sidemark: item.expected_sidemark || null,
                                  });
                                } catch (err: unknown) {
                                  toast({
                                    variant: 'destructive',
                                    title: 'Failed to save sidemark',
                                    description: err instanceof Error ? err.message : 'Could not save item sidemark.',
                                  });
                                  refetch();
                                }
                              }}
                              placeholder="Sidemark"
                              className="h-8"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={item.room || ''}
                              onChange={(e) => updateLocalItem(item.id, 'room', e.target.value)}
                              onBlur={async () => {
                                try {
                                  await persistItemPatch(item.id, {
                                    room: item.room || null,
                                  });
                                } catch (err: unknown) {
                                  toast({
                                    variant: 'destructive',
                                    title: 'Failed to save room',
                                    description: err instanceof Error ? err.message : 'Could not save item room.',
                                  });
                                  refetch();
                                }
                              }}
                              placeholder="Room"
                              className="h-8"
                            />
                          </TableCell>
                          <TableCell>
                            <Badge variant={allocationBadgeVariant(item)}>
                              {allocationSummary(item)}
                            </Badge>
                            {item.allocations.length > 0 && (
                              <div className="mt-1 space-y-1">
                                {item.allocations.map((alloc) => (
                                  <div key={alloc.id} className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <MaterialIcon name="arrow_forward" size="sm" />
                                    <span>{alloc.expected_shipment_number || 'Expected'}</span>
                                    <span>({alloc.allocated_qty})</span>
                                    <button
                                      onClick={() => handleDeallocate(alloc.id)}
                                      disabled={deallocating}
                                      className="ml-1 hover:text-destructive"
                                      title="Remove allocation"
                                    >
                                      <MaterialIcon name="close" size="sm" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                                title="Duplicate item"
                                onClick={() => handleDuplicateItem(item)}
                              >
                                <MaterialIcon name="content_copy" size="sm" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 text-red-500 hover:text-red-700"
                                title={item.allocations.length > 0 ? 'Deallocate before removing' : 'Remove item'}
                                onClick={() => handleRemoveItem(item)}
                                disabled={item.allocations.length > 0}
                              >
                                <MaterialIcon name="delete" size="sm" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Activity */}
      <div className="mt-6">
        <EntityActivityFeed
          entityType="shipment"
          entityId={id}
          title="Activity"
          description="Complete timeline of billing, operations, and status changes for this manifest"
        />
      </div>

      {showImportDialog && (
        <ManifestImportDialog
          shipmentId={id}
          open={showImportDialog}
          onClose={handleImportComplete}
        />
      )}

      {/* Add Item Dialog */}
      <Dialog open={showAddItemDialog} onOpenChange={setShowAddItemDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Manifest Item</DialogTitle>
            <DialogDescription>
              Manually add an item to this manifest.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Description</Label>
                <Input
                  value={addItemDesc}
                  onChange={(e) => setAddItemDesc(e.target.value)}
                  placeholder="Item description"
                />
              </div>
              <div className="space-y-1">
                <Label>Vendor</Label>
                <Input
                  value={addItemVendor}
                  onChange={(e) => setAddItemVendor(e.target.value)}
                  placeholder="Vendor name"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label>Sidemark</Label>
                <Input
                  value={addItemSidemark}
                  onChange={(e) => setAddItemSidemark(e.target.value)}
                  placeholder="Sidemark"
                />
              </div>
              <div className="space-y-1">
                <Label>Room</Label>
                <Input
                  value={addItemRoom}
                  onChange={(e) => setAddItemRoom(e.target.value)}
                  placeholder="Room"
                />
              </div>
              <div className="space-y-1">
                <Label>Quantity</Label>
                <Input
                  type="number"
                  min={1}
                  value={addItemQty}
                  onChange={(e) => setAddItemQty(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea
                value={addItemNotes}
                onChange={(e) => setAddItemNotes(e.target.value)}
                placeholder="Optional notes for this item..."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddItemDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddItem} disabled={addingItem || !addItemDesc.trim()}>
              {addingItem ? 'Adding...' : 'Add Item'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
