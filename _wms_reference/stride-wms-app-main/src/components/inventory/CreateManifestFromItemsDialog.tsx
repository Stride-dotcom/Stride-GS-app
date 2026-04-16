import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
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
import { useWarehouses } from '@/hooks/useWarehouses';
import { useManifests } from '@/hooks/useManifests';
import { useToast } from '@/hooks/use-toast';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface SelectedItem {
  id: string;
  item_code: string;
  description: string | null;
  quantity: number;
  client_account: string | null;
  warehouse_id: string | null;
}

interface CreateManifestFromItemsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedItems: SelectedItem[];
  onSuccess: () => void;
}

export function CreateManifestFromItemsDialog({
  open,
  onOpenChange,
  selectedItems,
  onSuccess,
}: CreateManifestFromItemsDialogProps) {
  const { toast } = useToast();
  const { warehouses } = useWarehouses();
  const { createManifest, addItemsToManifest } = useManifests();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    warehouse_id: '',
    scheduled_date: '',
    notes: '',
  });
  const [itemsList, setItemsList] = useState<SelectedItem[]>([]);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setItemsList([...selectedItems]);

      // Auto-detect warehouse from items
      const warehouseIds = new Set(selectedItems.map(i => i.warehouse_id).filter(Boolean));
      const defaultWarehouse = warehouseIds.size === 1 ? Array.from(warehouseIds)[0] : '';

      setFormData({
        name: '',
        description: '',
        warehouse_id: defaultWarehouse || '',
        scheduled_date: '',
        notes: '',
      });
    }
  }, [open, selectedItems]);

  const handleRemoveItem = (itemId: string) => {
    setItemsList(prev => prev.filter(i => i.id !== itemId));
  };

  const handleSubmit = async () => {
    if (!formData.warehouse_id || !formData.name || itemsList.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Validation Error',
        description: 'Please fill in all required fields and ensure at least one item is selected.',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      // Create the manifest
      const manifest = await createManifest({
        name: formData.name,
        description: formData.description || undefined,
        warehouse_id: formData.warehouse_id,
        billable: false,
        scheduled_date: formData.scheduled_date || undefined,
        notes: formData.notes || undefined,
      });

      if (!manifest) {
        throw new Error('Failed to create manifest');
      }

      // Add items to the manifest
      await addItemsToManifest(manifest.id, itemsList.map(i => i.id));

      toast({
        title: 'Manifest Created',
        description: `Created manifest "${formData.name}" with ${itemsList.length} items.`,
      });

      onOpenChange(false);
      onSuccess();
    } catch (error: any) {
      console.error('Error creating manifest:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to create manifest.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Get unique accounts from selected items
  const uniqueAccounts = new Set(itemsList.map(i => i.client_account).filter(Boolean));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MaterialIcon name="assignment" size="md" />
            Create Manifest from Selected Items
          </DialogTitle>
          <DialogDescription>
            Create a new manifest with the selected inventory items for targeted stocktake.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4 -mr-4">
          <div className="space-y-6 py-4">
            {/* Basic Info */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="manifest-name">
                  Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="manifest-name"
                  placeholder="e.g., Weekly Zone A Audit"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="manifest-warehouse">
                  Warehouse <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={formData.warehouse_id}
                  onValueChange={(v) => setFormData(prev => ({ ...prev, warehouse_id: v }))}
                >
                  <SelectTrigger id="manifest-warehouse">
                    <SelectValue placeholder="Select warehouse" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses.map((wh) => (
                      <SelectItem key={wh.id} value={wh.id}>
                        {wh.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="manifest-description">Description</Label>
              <Textarea
                id="manifest-description"
                placeholder="Optional description of this manifest..."
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                rows={2}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="manifest-date">Scheduled Date</Label>
                <Input
                  id="manifest-date"
                  type="date"
                  value={formData.scheduled_date}
                  onChange={(e) => setFormData(prev => ({ ...prev, scheduled_date: e.target.value }))}
                />
              </div>
            </div>

            {/* Summary Stats */}
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">
                {itemsList.length} item{itemsList.length !== 1 ? 's' : ''}
              </Badge>
              {uniqueAccounts.size > 0 && (
                <Badge variant="outline">
                  {uniqueAccounts.size} account{uniqueAccounts.size !== 1 ? 's' : ''}
                </Badge>
              )}
            </div>

            {/* Items List */}
            <div className="space-y-2">
              <Label>Selected Items</Label>
              <div className="border rounded-md max-h-[250px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item Code</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {itemsList.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          No items selected
                        </TableCell>
                      </TableRow>
                    ) : (
                      itemsList.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-mono text-sm font-medium">
                            {item.item_code}
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate">
                            {item.description || '-'}
                          </TableCell>
                          <TableCell className="text-right">{item.quantity}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {item.client_account || '-'}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => handleRemoveItem(item.id)}
                            >
                              <MaterialIcon name="delete" size="sm" className="text-muted-foreground hover:text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="manifest-notes">Notes</Label>
              <Textarea
                id="manifest-notes"
                placeholder="Additional notes..."
                value={formData.notes}
                onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                rows={2}
              />
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!formData.warehouse_id || !formData.name || itemsList.length === 0 || isSubmitting}
          >
            {isSubmitting && <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />}
            Create Manifest
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
