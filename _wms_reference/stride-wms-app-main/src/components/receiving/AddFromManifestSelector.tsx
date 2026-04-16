import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface ManifestItem {
  id: string;
  expected_description: string | null;
  expected_quantity: number;
  expected_class_id: string | null;
  expected_vendor: string | null;
  expected_sidemark: string | null;
  allocated_qty: number;
  shipment_id: string;
  shipment_number?: string;
}

interface AddFromManifestSelectorProps {
  shipmentId: string;
  accountId: string | null;
  open: boolean;
  onClose: () => void;
  onAdd: (items: ManifestItem[]) => void;
  onOpenMatchingPanel?: () => void;
}

export function AddFromManifestSelector({
  shipmentId,
  accountId,
  open,
  onClose,
  onAdd,
  onOpenMatchingPanel,
}: AddFromManifestSelectorProps) {
  const { profile } = useAuth();
  const [items, setItems] = useState<ManifestItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open || !profile?.tenant_id) return;
    fetchAvailableItems();
  }, [open, profile?.tenant_id]);

  const fetchAvailableItems = async () => {
    if (!profile?.tenant_id) return;
    setLoading(true);
    try {
      // Fetch shipment_items from linked manifests/expected shipments
      // that have unallocated quantities available
      const { data: links } = await (supabase as any)
        .from('inbound_links')
        .select('linked_shipment_id')
        .eq('dock_intake_id', shipmentId)
        .eq('tenant_id', profile.tenant_id);

      const linkedIds = (links || []).map((l: any) => l.linked_shipment_id);

      if (linkedIds.length === 0) {
        setItems([]);
        setLoading(false);
        return;
      }

      // Get items from linked shipments
      const { data, error } = await (supabase as any)
        .from('shipment_items')
        .select(`
          id,
          expected_description,
          expected_quantity,
          expected_class_id,
          expected_vendor,
          expected_sidemark,
          allocated_qty,
          shipment_id,
          shipments!inner(shipment_number)
        `)
        .in('shipment_id', linkedIds)
        .eq('status', 'pending');

      if (error) throw error;

      const mappedItems: ManifestItem[] = (data || []).map((item: any) => ({
        ...item,
        shipment_number: item.shipments?.shipment_number,
      }));

      setItems(mappedItems);
    } catch (err) {
      console.error('[AddFromManifestSelector] fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleItem = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filteredItems.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredItems.map(i => i.id)));
    }
  };

  const handleAdd = () => {
    const selectedItems = items.filter(i => selected.has(i.id));
    onAdd(selectedItems);
    setSelected(new Set());
    onClose();
  };

  const filteredItems = items.filter(item => {
    if (!search.trim()) return true;
    const term = search.toLowerCase();
    return (
      item.expected_description?.toLowerCase().includes(term) ||
      item.expected_vendor?.toLowerCase().includes(term) ||
      item.shipment_number?.toLowerCase().includes(term)
    );
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="border-b p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            <MaterialIcon name="close" size="md" />
          </Button>
          <h2 className="text-lg font-semibold">Add From Manifest / Expected</h2>
          {selected.size > 0 && (
            <Badge>{selected.size} selected</Badge>
          )}
        </div>
        <Button onClick={handleAdd} disabled={selected.size === 0}>
          <MaterialIcon name="add" size="sm" className="mr-1" />
          Add Selected ({selected.size})
        </Button>
      </div>

      {/* Search */}
      <div className="p-4 border-b">
        <div className="relative max-w-md">
          <MaterialIcon
            name="search"
            size="sm"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Search items..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-primary" />
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <MaterialIcon name="inventory_2" size="xl" className="mb-3 opacity-30" />
            <h3 className="text-lg font-medium mb-1">No planned items available</h3>
            <p className="text-sm text-muted-foreground mb-4 max-w-md">
              Link this dock intake to a manifest or expected shipment to see available items.
            </p>
            {onOpenMatchingPanel && (
              <Button variant="outline" onClick={onOpenMatchingPanel}>
                <MaterialIcon name="search" size="sm" className="mr-2" />
                Open Matching Panel
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {/* Select all */}
            <div
              className="flex items-center gap-3 p-3 rounded-md bg-muted/30 cursor-pointer hover:bg-muted/50"
              onClick={toggleAll}
            >
              <Checkbox
                checked={selected.size === filteredItems.length && filteredItems.length > 0}
                onCheckedChange={() => toggleAll()}
              />
              <span className="text-sm font-medium">Select All ({filteredItems.length})</span>
            </div>

            {filteredItems.map((item) => (
              <div
                key={item.id}
                className={`flex items-center gap-3 p-3 rounded-md border cursor-pointer transition-colors ${
                  selected.has(item.id) ? 'border-primary bg-primary/5' : 'hover:bg-muted/30'
                }`}
                onClick={() => toggleItem(item.id)}
              >
                <Checkbox
                  checked={selected.has(item.id)}
                  onCheckedChange={() => toggleItem(item.id)}
                />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">
                    {item.expected_description || 'No description'}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    <span>Qty: {item.expected_quantity}</span>
                    {item.expected_vendor && <span>· {item.expected_vendor}</span>}
                    {item.shipment_number && (
                      <Badge variant="outline" className="text-[10px]">{item.shipment_number}</Badge>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
