import { useState, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { HelpTip } from '@/components/ui/help-tip';
import { useIncomingShipments } from '@/hooks/useIncomingShipments';
import { useAllocation } from '@/hooks/useAllocation';
import type { ManifestItem } from '@/hooks/useInboundManifestDetail';

interface AllocationPickerProps {
  manifestShipmentId: string;
  manifestItems: ManifestItem[];
  onComplete: () => void;
  onCancel: () => void;
}

interface QtyEntry {
  itemId: string;
  qty: number;
}

export default function AllocationPicker({
  manifestShipmentId,
  manifestItems,
  onComplete,
  onCancel,
}: AllocationPickerProps) {
  const [search, setSearch] = useState('');
  const [selectedExpectedId, setSelectedExpectedId] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<QtyEntry[]>(() =>
    manifestItems.map((item) => ({
      itemId: item.id,
      qty: Math.max((item.expected_quantity ?? 0) - (item.allocated_qty ?? 0), 0),
    }))
  );

  const { shipments: expectedShipments, loading: loadingExpected } = useIncomingShipments({
    inbound_kind: 'expected',
    search: search || undefined,
  });

  const { allocate, loading: allocating } = useAllocation();

  const updateQty = useCallback((itemId: string, qty: number) => {
    setQuantities((prev) =>
      prev.map((e) => (e.itemId === itemId ? { ...e, qty: Math.max(0, qty) } : e))
    );
  }, []);

  const totalQty = useMemo(() => quantities.reduce((sum, e) => sum + e.qty, 0), [quantities]);

  const handleAllocate = async () => {
    if (!selectedExpectedId || totalQty === 0) return;

    const itemIds: string[] = [];
    const qtys: number[] = [];

    for (const entry of quantities) {
      if (entry.qty > 0) {
        itemIds.push(entry.itemId);
        qtys.push(entry.qty);
      }
    }

    const result = await allocate(itemIds, selectedExpectedId, qtys);
    if (result?.success) {
      onComplete();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-background">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            <MaterialIcon name="close" size="sm" className="mr-1" />
            Cancel
          </Button>
          <h2 className="text-lg font-semibold">Allocate Items to Expected Shipment</h2>
          <HelpTip
            tooltip="Select an expected shipment on the right, adjust quantities on the left, then click Allocate. This creates explicit provenance links between manifest items and expected items."
            pageKey="incoming.allocation_picker"
            fieldKey="allocation_workflow"
          />
        </div>
        <Button
          onClick={handleAllocate}
          disabled={!selectedExpectedId || totalQty === 0 || allocating}
        >
          {allocating ? (
            <MaterialIcon name="progress_activity" size="sm" className="animate-spin mr-1" />
          ) : (
            <MaterialIcon name="link" size="sm" className="mr-1" />
          )}
          Allocate {totalQty} Unit{totalQty !== 1 ? 's' : ''}
        </Button>
      </div>

      {/* Split panels */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Manifest items */}
        <div className="w-1/2 border-r overflow-auto p-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Manifest Items ({manifestItems.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead className="text-right">Available</TableHead>
                      <TableHead className="text-right w-[100px]">Allocate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {manifestItems.map((item) => {
                      const remaining = Math.max(
                        (item.expected_quantity ?? 0) - (item.allocated_qty ?? 0),
                        0
                      );
                      const entry = quantities.find((e) => e.itemId === item.id);
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium max-w-[180px] truncate">
                            {item.expected_description || '-'}
                          </TableCell>
                          <TableCell>{item.expected_vendor || '-'}</TableCell>
                          <TableCell className="text-right">{remaining}</TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min={0}
                              max={remaining}
                              value={entry?.qty ?? 0}
                              onChange={(e) =>
                                updateQty(item.id, Math.min(Number(e.target.value), remaining))
                              }
                              className="w-20 text-right ml-auto"
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: Expected shipment selector */}
        <div className="w-1/2 overflow-auto p-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                Select Expected Shipment
                <HelpTip
                  tooltip="Choose which expected shipment to allocate manifest items to. Items are copied to the expected shipment with explicit provenance."
                  pageKey="incoming.allocation_picker"
                  fieldKey="expected_shipment_selector"
                />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-3">
                <div className="relative">
                  <MaterialIcon
                    name="search"
                    size="sm"
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    placeholder="Search expected shipments..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-8"
                  />
                </div>
              </div>

              {loadingExpected ? (
                <div className="flex items-center justify-center py-8">
                  <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-primary" />
                </div>
              ) : expectedShipments.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <MaterialIcon name="search_off" size="xl" className="mb-2 opacity-40" />
                  <p>No expected shipments found.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {expectedShipments.map((es) => (
                    <div
                      key={es.id}
                      className={`p-3 rounded-md border cursor-pointer transition-colors ${
                        selectedExpectedId === es.id
                          ? 'border-primary bg-primary/5'
                          : 'hover:bg-muted/50'
                      }`}
                      onClick={() => setSelectedExpectedId(es.id)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-medium text-sm">
                          {es.shipment_number}
                        </span>
                        <Badge variant={selectedExpectedId === es.id ? 'default' : 'outline'}>
                          {es.inbound_status || 'open'}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {es.account_name || 'No account'} &middot;
                        {es.vendor_name ? ` ${es.vendor_name} &middot;` : ''}
                        {es.expected_pieces ? ` ${es.expected_pieces} pcs` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
