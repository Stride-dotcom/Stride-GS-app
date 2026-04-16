/**
 * AddClaimItemDialog Component
 * Dialog for adding inventory or non-inventory items to an existing claim
 */

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

interface AddClaimItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  claimId: string;
  accountId?: string;
  sidemarkId?: string;
  onSuccess: () => void;
}

interface InventoryItem {
  id: string;
  item_code: string;
  description: string | null;
  coverage_type: string | null;
  declared_value: number | null;
  weight_lbs: number | null;
  coverage_rate: number | null;
}

export function AddClaimItemDialog({
  open,
  onOpenChange,
  claimId,
  accountId,
  sidemarkId,
  onSuccess,
}: AddClaimItemDialogProps) {
  const { toast } = useToast();
  const { profile } = useAuth();
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'inventory' | 'non-inventory'>('inventory');
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  // Form state for inventory item
  const [selectedItemId, setSelectedItemId] = useState('');
  const [requestedAmount, setRequestedAmount] = useState('');
  const [itemNotes, setItemNotes] = useState('');

  // Form state for non-inventory item
  const [nonInventoryRef, setNonInventoryRef] = useState('');
  const [nonInventoryDescription, setNonInventoryDescription] = useState('');
  const [nonInventoryAmount, setNonInventoryAmount] = useState('');

  // Fetch inventory items when dialog opens
  useEffect(() => {
    if (open && accountId && profile?.tenant_id) {
      fetchInventoryItems();
    }
  }, [open, accountId, profile?.tenant_id]);

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setSelectedItemId('');
      setRequestedAmount('');
      setItemNotes('');
      setNonInventoryRef('');
      setNonInventoryDescription('');
      setNonInventoryAmount('');
      setActiveTab('inventory');
    }
  }, [open]);

  const fetchInventoryItems = async () => {
    if (!profile?.tenant_id) return;

    setLoadingItems(true);
    try {
      let query = supabase
        .from('items')
        .select('id, item_code, description, coverage_type, declared_value, weight_lbs, coverage_rate')
        .eq('tenant_id', profile.tenant_id)
        .eq('status', 'in_storage')
        .is('deleted_at', null);

      if (accountId) {
        query = query.eq('account_id', accountId);
      }
      if (sidemarkId) {
        query = query.eq('sidemark_id', sidemarkId);
      }

      const { data, error } = await query.order('item_code', { ascending: true }).limit(500);

      if (error) throw error;
      setInventoryItems((data || []) as InventoryItem[]);
    } catch (error) {
      console.error('Error fetching inventory items:', error);
    } finally {
      setLoadingItems(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!profile?.tenant_id) return;

    // Validate based on active tab
    if (activeTab === 'inventory' && !selectedItemId) {
      toast({
        variant: 'destructive',
        title: 'Item Required',
        description: 'Please select an inventory item.',
      });
      return;
    }

    if (activeTab === 'non-inventory' && !nonInventoryRef) {
      toast({
        variant: 'destructive',
        title: 'Reference Required',
        description: 'Please enter a reference for the non-inventory item.',
      });
      return;
    }

    setSaving(true);
    try {
      if (activeTab === 'inventory') {
        // Get item details for coverage snapshot
        const selectedItem = inventoryItems.find(i => i.id === selectedItemId);

        const insertData = {
          tenant_id: profile.tenant_id,
          claim_id: claimId,
          item_id: selectedItemId,
          coverage_type: selectedItem?.coverage_type || null,
          declared_value: selectedItem?.declared_value || null,
          weight_lbs: selectedItem?.weight_lbs || null,
          coverage_rate: selectedItem?.coverage_rate || null,
          requested_amount: requestedAmount ? parseFloat(requestedAmount) : null,
          item_notes: itemNotes || null,
        };

        const { error } = await supabase.from('claim_items').insert([insertData]);
        if (error) throw error;

        // Add audit entry
        await supabase.from('claim_audit').insert([{
          tenant_id: profile.tenant_id,
          claim_id: claimId,
          actor_id: profile.id,
          action: 'item_added',
          details: {
            item_id: selectedItemId,
            item_code: selectedItem?.item_code,
          },
        }]);

        toast({
          title: 'Item Added',
          description: `Item ${selectedItem?.item_code} has been added to the claim.`,
        });
      } else {
        // Non-inventory item
        const insertData = {
          tenant_id: profile.tenant_id,
          claim_id: claimId,
          item_id: null,
          non_inventory_ref: nonInventoryRef,
          requested_amount: nonInventoryAmount ? parseFloat(nonInventoryAmount) : null,
          item_notes: nonInventoryDescription || null,
        };

        const { error } = await supabase.from('claim_items').insert([insertData]);
        if (error) throw error;

        // Add audit entry
        await supabase.from('claim_audit').insert([{
          tenant_id: profile.tenant_id,
          claim_id: claimId,
          actor_id: profile.id,
          action: 'non_inventory_item_added',
          details: {
            reference: nonInventoryRef,
          },
        }]);

        toast({
          title: 'Item Added',
          description: 'Non-inventory item has been added to the claim.',
        });
      }

      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error adding claim item:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to add item to claim',
      });
    } finally {
      setSaving(false);
    }
  };

  const itemOptions = inventoryItems.map(item => ({
    value: item.id,
    label: `${item.item_code}${item.description ? ` - ${item.description}` : ''}`,
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MaterialIcon name="add_circle" size="md" />
            Add Item to Claim
          </DialogTitle>
          <DialogDescription>
            Add an inventory item or non-inventory reference to this claim.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'inventory' | 'non-inventory')}>
            <TabsList className="w-full">
              <TabsTrigger value="inventory" className="flex-1">
                <MaterialIcon name="inventory_2" size="sm" className="mr-2" />
                Inventory Item
              </TabsTrigger>
              <TabsTrigger value="non-inventory" className="flex-1">
                <MaterialIcon name="description" size="sm" className="mr-2" />
                Non-Inventory
              </TabsTrigger>
            </TabsList>

            <TabsContent value="inventory" className="space-y-4 mt-4">
              {!accountId && (
                <div className="flex items-start gap-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-md text-sm text-yellow-600 dark:text-yellow-400">
                  <MaterialIcon name="warning" size="sm" className="mt-0.5 flex-shrink-0" />
                  <p>No account is linked to this claim. Showing all inventory items.</p>
                </div>
              )}

              <div className="space-y-2">
                <Label>
                  Select Item <span className="text-destructive">*</span>
                </Label>
                {loadingItems ? (
                  <div className="h-10 bg-muted rounded-md animate-pulse" />
                ) : (
                  <SearchableSelect
                    options={itemOptions}
                    value={selectedItemId}
                    onChange={setSelectedItemId}
                    placeholder="Search items..."
                  />
                )}
              </div>

              <div className="space-y-2">
                <Label>Requested Amount</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={requestedAmount}
                    onChange={(e) => setRequestedAmount(e.target.value)}
                    placeholder="0.00"
                    className="pl-7"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  value={itemNotes}
                  onChange={(e) => setItemNotes(e.target.value)}
                  placeholder="Additional notes about the damage..."
                  rows={2}
                />
              </div>
            </TabsContent>

            <TabsContent value="non-inventory" className="space-y-4 mt-4">
              <div className="flex items-start gap-2 p-3 bg-muted rounded-md text-sm">
                <MaterialIcon name="info" size="sm" className="mt-0.5 flex-shrink-0 text-muted-foreground" />
                <p className="text-muted-foreground">
                  Use this for claims not related to inventory items, such as property damage during delivery.
                </p>
              </div>

              <div className="space-y-2">
                <Label>
                  Reference <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={nonInventoryRef}
                  onChange={(e) => setNonInventoryRef(e.target.value)}
                  placeholder="e.g., Wall damage at 123 Main St"
                />
              </div>

              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={nonInventoryDescription}
                  onChange={(e) => setNonInventoryDescription(e.target.value)}
                  placeholder="Describe the damage or issue..."
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label>Requested Amount</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={nonInventoryAmount}
                    onChange={(e) => setNonInventoryAmount(e.target.value)}
                    placeholder="0.00"
                    className="pl-7"
                  />
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter className="pt-4 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />}
              Add Item
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
