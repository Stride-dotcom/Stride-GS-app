import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { ShipmentNotesSection } from '@/components/shipments/ShipmentNotesSection';
import { isValidUuid } from '@/lib/utils';
import { useExpectedShipmentDetail } from '@/hooks/useExpectedShipmentDetail';
import { useExternalRefs, type RefType } from '@/hooks/useExternalRefs';
import { useClasses } from '@/hooks/useClasses';
import { useItemDisplaySettingsForUser } from '@/hooks/useItemDisplaySettingsForUser';
import { logActivity } from '@/lib/activity/logActivity';
import { EntityActivityFeed } from '@/components/activity/EntityActivityFeed';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { ItemColumnsPopover } from '@/components/items/ItemColumnsPopover';
import { ItemPreviewCard } from '@/components/items/ItemPreviewCard';
import { formatItemSize } from '@/lib/items/formatItemSize';
import {
  type BuiltinItemColumnKey,
  type ItemColumnKey,
  getColumnLabel,
  getViewById,
  getVisibleColumnsForView,
  parseCustomFieldColumnKey,
} from '@/lib/items/itemDisplaySettings';

function formatDate(d: string | null | undefined): string {
  if (!d) return '-';
  return new Date(d).toLocaleDateString();
}

export default function ExpectedShipmentDetail() {
  const { id } = useParams<{ id: string }>();

  if (!id || !isValidUuid(id)) {
    return <Navigate to="/incoming" replace />;
  }

  const navigate = useNavigate();
  const { profile } = useAuth();
  const { toast } = useToast();
  const { shipment, items, refs: shipmentRefs, loading, refetch } = useExpectedShipmentDetail(id);
  const { refs, addRef, removeRef } = useExternalRefs(id);
  const { classes, loading: classesLoading } = useClasses();

  // Item table view (tenant-managed)
  const {
    settings: itemDisplaySettings,
    tenantSettings: tenantItemDisplaySettings,
    defaultViewId: defaultItemViewId,
    loading: itemDisplayLoading,
    saving: itemDisplaySaving,
    saveSettings: saveItemDisplaySettings,
  } = useItemDisplaySettingsForUser();
  const [activeItemViewId, setActiveItemViewId] = useState<string>('');

  useEffect(() => {
    if (!activeItemViewId && defaultItemViewId) {
      setActiveItemViewId(defaultItemViewId);
    }
  }, [defaultItemViewId, activeItemViewId]);

  const activeItemView = useMemo(() => {
    return (
      getViewById(itemDisplaySettings, activeItemViewId) ||
      getViewById(itemDisplaySettings, defaultItemViewId) ||
      itemDisplaySettings.views[0]
    );
  }, [itemDisplaySettings, activeItemViewId, defaultItemViewId]);

  const expectedItemVisibleColumns = useMemo(
    () => (activeItemView ? getVisibleColumnsForView(activeItemView) : []),
    [activeItemView]
  );

  const [newRefType, setNewRefType] = useState<RefType>('BOL');
  const [newRefValue, setNewRefValue] = useState('');
  const [itemRows, setItemRows] = useState(items);

  // Editable header
  const [editingHeader, setEditingHeader] = useState(false);
  const [headerVendor, setHeaderVendor] = useState('');
  const [headerCarrier, setHeaderCarrier] = useState('');
  const [headerSidemark, setHeaderSidemark] = useState('');
  const [headerEtaStart, setHeaderEtaStart] = useState('');
  const [headerEtaEnd, setHeaderEtaEnd] = useState('');
  const [headerPieces, setHeaderPieces] = useState('');
  const [headerSaving, setHeaderSaving] = useState(false);

  // Add item form
  const [showAddItemDialog, setShowAddItemDialog] = useState(false);
  const [addItemDesc, setAddItemDesc] = useState('');
  const [addItemVendor, setAddItemVendor] = useState('');
  const [addItemSidemark, setAddItemSidemark] = useState('');
  const [addItemRoom, setAddItemRoom] = useState('');
  const [addItemQty, setAddItemQty] = useState('1');
  const [addItemNotes, setAddItemNotes] = useState('');
  const [addItemDeclaredValue, setAddItemDeclaredValue] = useState('');
  const [addingItem, setAddingItem] = useState(false);

  useEffect(() => {
    setItemRows(items);
  }, [items]);

  const handleAddRef = async () => {
    if (!newRefValue.trim()) return;
    await addRef(newRefType, newRefValue);
    setNewRefValue('');
  };

  const updateLocalItem = (itemId: string, field: string, value: unknown) => {
    setItemRows((prev) =>
      prev.map((item) => (item.id === itemId ? ({ ...item, [field]: value }) : item))
    );
  };

  const persistItemPatch = async (itemId: string, patch: Record<string, unknown>) => {
    const { error } = await (supabase.from('shipment_items') as any)
      .update(patch)
      .eq('id', itemId);

    if (error) throw error;
  };

  const getAllocationCountForItem = async (itemId: string) => {
    const { count, error } = await (supabase.from('shipment_item_allocations') as any)
      .select('id', { head: true, count: 'exact' })
      .or(`expected_shipment_item_id.eq.${itemId},manifest_shipment_item_id.eq.${itemId}`);

    if (error) throw error;
    return count ?? 0;
  };

  const handleDuplicateItem = async (item: (typeof itemRows)[number]) => {
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
        declared_value: item.declared_value || null,
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
          eventLabel: `Expected item duplicated: ${item.expected_description || 'Item'}`,
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

  const handleRemoveItem = async (itemId: string) => {
    try {
      const allocationCount = await getAllocationCountForItem(itemId);
      if (allocationCount > 0) {
        toast({
          variant: 'destructive',
          title: 'Item is allocated',
          description: 'Deallocate this item before removing it from the expected shipment.',
        });
        return;
      }

      const { error } = await (supabase.from('shipment_items') as any)
        .delete()
        .eq('id', itemId);

      if (error) throw error;

      if (profile?.tenant_id && profile?.id && id) {
        void logActivity({
          entityType: 'shipment',
          tenantId: profile.tenant_id,
          entityId: id,
          actorUserId: profile.id,
          eventType: 'item_removed',
          eventLabel: 'Expected item removed',
          details: { shipment_item_id: itemId },
        });
      }

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

  const handleEditHeader = () => {
    if (!shipment) return;
    setHeaderVendor(shipment.vendor_name || '');
    setHeaderCarrier((shipment as any).carrier as string || '');
    setHeaderSidemark((shipment as any).sidemark as string || '');
    setHeaderEtaStart(shipment.eta_start ? String(shipment.eta_start).split('T')[0] : '');
    setHeaderEtaEnd(shipment.eta_end ? String(shipment.eta_end).split('T')[0] : '');
    setHeaderPieces(shipment.expected_pieces?.toString() || '');
    setEditingHeader(true);
  };

  const handleSaveHeader = async () => {
    if (!shipment) return;
    try {
      setHeaderSaving(true);
      const { error } = await supabase
        .from('shipments')
        .update({
          vendor_name: headerVendor || null,
          carrier: headerCarrier || null,
          sidemark: headerSidemark || null,
          eta_start: headerEtaStart || null,
          eta_end: headerEtaEnd || null,
          expected_pieces: headerPieces ? Number(headerPieces) : null,
        } as Record<string, unknown>)
        .eq('id', shipment.id);
      if (error) throw error;
      toast({ title: 'Expected Shipment Updated' });
      setEditingHeader(false);
      refetch();
    } catch (err: unknown) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to update',
      });
    } finally {
      setHeaderSaving(false);
    }
  };

  const handleAddItem = async () => {
    if (!profile?.tenant_id || !id) return;
    try {
      setAddingItem(true);
      const dvParsed = parseFloat(addItemDeclaredValue);
      const declaredValue = !isNaN(dvParsed) && dvParsed > 0 ? dvParsed : null;
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
          declared_value: declaredValue,
        });
      if (error) throw error;

      void logActivity({
        entityType: 'shipment',
        tenantId: profile.tenant_id,
        entityId: id,
        actorUserId: profile.id,
        eventType: 'item_added',
        eventLabel: `Expected item added: ${addItemDesc || 'Item'}`,
        details: {
          expected_description: addItemDesc || null,
          expected_vendor: addItemVendor || null,
          expected_sidemark: addItemSidemark || null,
          room: addItemRoom || null,
          expected_quantity: Number(addItemQty) || 1,
        },
      });

      toast({ title: 'Item Added' });
      setShowAddItemDialog(false);
      setAddItemDesc('');
      setAddItemVendor('');
      setAddItemSidemark('');
      setAddItemRoom('');
      setAddItemQty('1');
      setAddItemNotes('');
      setAddItemDeclaredValue('');
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

  if (!shipment) {
    return (
      <DashboardLayout>
        <div className="text-center py-24 text-muted-foreground">
          <MaterialIcon name="error_outline" size="xl" className="mb-2 opacity-40" />
          <p>Expected shipment not found.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/incoming')}>
            Back to Incoming Manager
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const displayRefs = refs.length > 0 ? refs : shipmentRefs;
  const carrierName = (shipment as any).carrier as string | null;
  const inboundStatusLabel = (shipment.inbound_status || 'open').replace(/_/g, ' ');

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Top row (match Dock Intake layout) */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/incoming')}
              className="gap-1"
            >
              <MaterialIcon name="arrow_back" size="sm" />
              Back
            </Button>
            <PageHeader
              primaryText="Expected"
              accentText="Shipment"
              description="Plan and manage expected inbound shipments"
            />
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={handleEditHeader}>
              <MaterialIcon name="edit" size="sm" className="mr-1" />
              Edit Details
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowAddItemDialog(true)}>
              <MaterialIcon name="add" size="sm" className="mr-1" />
              Add Item
            </Button>
          </div>
        </div>

        {/* Header card (match Dock Intake Stage styling) */}
        <Card className="border-primary/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MaterialIcon name="schedule" size="sm" className="text-primary" />
              <span>Expected Shipment</span>
              <ShipmentNumberBadge
                shipmentNumber={shipment.shipment_number}
                exceptionType={(shipment as any).shipment_exception_type}
              />
              <Badge variant="secondary" className="capitalize">
                {inboundStatusLabel}
              </Badge>
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {shipment.account_name ? <span>{shipment.account_name}</span> : <span className="italic">No account</span>}
              {shipment.vendor_name ? <span>{' '}· Vendor: {shipment.vendor_name}</span> : null}
              {carrierName ? <span>{' '}· Carrier: {carrierName}</span> : null}
              {(shipment as any).sidemark ? <span>{' '}· Sidemark: {(shipment as any).sidemark}</span> : null}
              <span>{' '}· Created {formatDate(shipment.created_at)}</span>
            </p>
          </CardHeader>
        </Card>

        {/* Edit Header Panel */}
        {editingHeader && (
          <Card className="border-primary/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Edit Expected Shipment Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">Vendor Name</Label>
                  <Input
                    value={headerVendor}
                    onChange={(e) => setHeaderVendor(e.target.value)}
                    placeholder="Enter vendor..."
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">
                    Carrier Name
                    <HelpTip
                      tooltip="The shipping carrier or trucking company delivering this shipment."
                      pageKey="incoming.expected_detail"
                      fieldKey="carrier_name"
                    />
                  </Label>
                  <Input
                    value={headerCarrier}
                    onChange={(e) => setHeaderCarrier(e.target.value)}
                    placeholder="Enter carrier..."
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Sidemark / Project</Label>
                  <Input
                    value={headerSidemark}
                    onChange={(e) => setHeaderSidemark(e.target.value)}
                    placeholder="e.g., Living Room Set"
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

        {/* Main content + sticky right summary (mirrors Dock Intake detail layout) */}
        <div className="grid gap-6 lg:grid-cols-[1fr,360px] items-start">
          <div className="space-y-6">
            {/* External References */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <MaterialIcon name="qr_code_scanner" size="sm" className="text-primary" />
                  External References
                  <HelpTip
                    tooltip="BOL, PRO, tracking numbers, POs. These references are used to match dock intakes to this expected shipment."
                    pageKey="incoming.expected_detail"
                    fieldKey="external_refs"
                  />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2 mb-3">
                  {displayRefs.map((ref) => (
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
                  {displayRefs.length === 0 && (
                    <span className="text-sm text-muted-foreground">No references yet.</span>
                  )}
                </div>
                <div className="flex gap-2 items-center flex-wrap">
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
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <MaterialIcon name="inventory_2" size="sm" className="text-primary" />
                    Expected Items
                    <HelpTip
                      tooltip="Items expected in this shipment. Items may be created manually or through allocation from a manifest."
                      pageKey="incoming.expected_detail"
                      fieldKey="expected_items"
                    />
                  </CardTitle>

                  <div className="flex items-center gap-2">
                    <Select
                      value={activeItemViewId || defaultItemViewId || 'default'}
                      onValueChange={setActiveItemViewId}
                      disabled={itemDisplayLoading || itemDisplaySettings.views.length === 0}
                    >
                      <SelectTrigger className="w-[140px] sm:w-[180px] h-9">
                        <div className="flex items-center gap-2">
                          <MaterialIcon name="view_list" size="sm" className="text-muted-foreground" />
                          <SelectValue placeholder="View" />
                        </div>
                      </SelectTrigger>
                      <SelectContent>
                        {itemDisplaySettings.views.map((v) => (
                          <SelectItem key={v.id} value={v.id}>
                            {v.name}
                            {v.is_default ? ' (default)' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <ItemColumnsPopover
                      settings={itemDisplaySettings}
                      baseSettings={tenantItemDisplaySettings}
                      viewId={activeItemViewId || defaultItemViewId || 'default'}
                      disabled={itemDisplayLoading || itemDisplaySaving || itemDisplaySettings.views.length === 0}
                      onSave={saveItemDisplaySettings}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {itemRows.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <MaterialIcon name="inventory_2" size="xl" className="mb-2 opacity-40" />
                    <p>No items yet. Add items manually or allocate from a manifest.</p>
                  </div>
                ) : (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {expectedItemVisibleColumns.map((col) => (
                            <TableHead
                              key={col}
                              className={col === 'quantity' || col === 'size' ? 'text-right' : undefined}
                            >
                              {getColumnLabel(itemDisplaySettings, col)}
                            </TableHead>
                          ))}
                          <TableHead className="w-44">Class</TableHead>
                          <TableHead className="w-28 text-right">Declared Value</TableHead>
                          <TableHead className="w-24 text-right">Actual</TableHead>
                          <TableHead className="w-28">Status</TableHead>
                          <TableHead className="w-28 text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {itemRows.map((item) => (
                          <TableRow key={item.id}>
                            {expectedItemVisibleColumns.map((col) => {
                              const cfKey = parseCustomFieldColumnKey(col);
                              if (cfKey) {
                                const meta = item.item?.metadata;
                                const custom = meta && typeof meta === 'object' ? (meta as any).custom_fields : null;
                                const raw = custom && typeof custom === 'object' ? (custom as any)[cfKey] : null;
                                const display = raw === null || raw === undefined || raw === '' ? '-' : String(raw);
                                return <TableCell key={col} className="max-w-[180px] truncate">{display}</TableCell>;
                              }

                              switch (col as BuiltinItemColumnKey) {
                                case 'photo': {
                                  const url = item.item?.primary_photo_url || null;
                                  const node = url ? (
                                    <img src={url} alt={item.item?.item_code || 'item'} className="h-8 w-8 rounded object-cover" />
                                  ) : (
                                    <div className="h-8 w-8 rounded bg-muted flex items-center justify-center text-sm">📦</div>
                                  );
                                  return (
                                    <TableCell key={col} className="w-12" onClick={(e) => e.stopPropagation()}>
                                      {item.item?.id ? <ItemPreviewCard itemId={item.item.id}>{node}</ItemPreviewCard> : node}
                                    </TableCell>
                                  );
                                }
                                case 'item_code': {
                                  const itemId = item.item?.id || item.item_id || null;
                                  const label = item.item?.item_code || (item.item_id ? item.item_id.slice(0, 8) : null);
                                  return (
                                    <TableCell key={col} className="font-mono font-medium">
                                      {itemId && label ? (
                                        <ItemPreviewCard itemId={itemId}>
                                          <span
                                            className="text-primary hover:underline cursor-pointer"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              navigate(`/inventory/${itemId}`);
                                            }}
                                          >
                                            {label}
                                          </span>
                                        </ItemPreviewCard>
                                      ) : (
                                        <span className="text-muted-foreground italic text-xs">pending</span>
                                      )}
                                    </TableCell>
                                  );
                                }
                                case 'sku':
                                  return <TableCell key={col}>{item.item?.sku || '-'}</TableCell>;
                                case 'quantity':
                                  return (
                                    <TableCell key={col} className="text-right">
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
                                  );
                                case 'size':
                                  return (
                                    <TableCell key={col} className="text-right tabular-nums">
                                      {formatItemSize(item.item?.size ?? null, item.item?.size_unit ?? null)}
                                    </TableCell>
                                  );
                                case 'vendor':
                                  return (
                                    <TableCell key={col}>
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
                                  );
                                case 'description':
                                  return (
                                    <TableCell key={col}>
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
                                  );
                                case 'location':
                                  return <TableCell key={col}>-</TableCell>;
                                case 'client_account':
                                  return <TableCell key={col}>{shipment?.account_name || '-'}</TableCell>;
                                case 'sidemark':
                                  return (
                                    <TableCell key={col}>
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
                                  );
                                case 'room':
                                  return (
                                    <TableCell key={col}>
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
                                  );
                                case 'received_date':
                                  return <TableCell key={col}>-</TableCell>;
                                default:
                                  return <TableCell key={col}>-</TableCell>;
                              }
                            })}
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
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                value={item.declared_value ?? ''}
                                onChange={(e) => updateLocalItem(item.id, 'declared_value', e.target.value === '' ? null : Number(e.target.value))}
                                onBlur={async () => {
                                  try {
                                    const val = item.declared_value != null ? Number(item.declared_value) : null;
                                    await persistItemPatch(item.id, {
                                      declared_value: val && val > 0 ? val : null,
                                    });
                                  } catch (err: unknown) {
                                    toast({
                                      variant: 'destructive',
                                      title: 'Failed to save declared value',
                                      description: err instanceof Error ? err.message : 'Could not save declared value.',
                                    });
                                    refetch();
                                  }
                                }}
                                placeholder="$0.00"
                                className="h-8 w-24 text-right"
                              />
                            </TableCell>
                            <TableCell className="text-right">{item.actual_quantity ?? '-'}</TableCell>
                            <TableCell>
                              <Badge variant={item.status === 'received' ? 'default' : 'outline'}>
                                {item.status || 'pending'}
                              </Badge>
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
                                  title="Remove item"
                                  onClick={() => handleRemoveItem(item.id)}
                                >
                                  <MaterialIcon name="delete" size="sm" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Unified Notes */}
            <ShipmentNotesSection
              shipmentId={id}
              accountId={shipment.account_id}
            />
          </div>

          {/* Right column: sticky summary (visual parity with Dock Intake matching panel column) */}
          <div className="lg:sticky lg:top-4 space-y-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <MaterialIcon name="business" size="sm" className="text-primary" />
                  Shipment Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">ETA Start</span>
                  <span className="font-medium">{formatDate(shipment.eta_start)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">ETA End</span>
                  <span className="font-medium">{formatDate(shipment.eta_end)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Carrier</span>
                  <span className="font-medium text-right">{carrierName || '-'}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Expected Pieces</span>
                  <span className="font-medium tabular-nums">{shipment.expected_pieces ?? '-'}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Items</span>
                  <span className="font-medium tabular-nums">{itemRows.length}</span>
                </div>
                <div className="pt-2 border-t">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">External Refs</span>
                    <span className="font-medium tabular-nums">{displayRefs.length}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Activity Feed */}
        <EntityActivityFeed
          entityType="shipment"
          entityId={id}
          title="Activity"
          description="Timeline of changes to this expected shipment"
        />
      </div>

      {/* Add Item Dialog */}
      <Dialog open={showAddItemDialog} onOpenChange={setShowAddItemDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Expected Item</DialogTitle>
            <DialogDescription>
              Manually add an item to this expected shipment.
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
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Declared Value ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={addItemDeclaredValue}
                  onChange={(e) => setAddItemDeclaredValue(e.target.value)}
                  placeholder="0.00"
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
