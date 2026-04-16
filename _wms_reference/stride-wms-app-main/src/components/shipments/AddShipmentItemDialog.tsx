/**
 * AddShipmentItemDialog Component
 * Dialog for adding new items to a shipment
 */

import { useState } from 'react';
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
import { AutocompleteInput } from '@/components/ui/autocomplete-input';
import { supabase } from '@/integrations/supabase/client';
import { useFieldSuggestions } from '@/hooks/useFieldSuggestions';
import { useToast } from '@/hooks/use-toast';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useAuth } from '@/contexts/AuthContext';
import { logActivity } from '@/lib/activity/logActivity';
import { getClassCubicFeetSingleValue } from '@/lib/pricing/classCubicFeet';

interface ClassOption {
  id: string;
  code: string;
  name: string;
}

interface AddShipmentItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shipmentId: string;
  accountId?: string;
  warehouseId?: string;
  sidemarkId?: string;
  tenantId?: string;
  onSuccess: () => void;
  classes?: ClassOption[];
  classOptional?: boolean;
  shipmentCoverageType?: string | null;
}

export function AddShipmentItemDialog({
  open,
  onOpenChange,
  shipmentId,
  accountId,
  warehouseId,
  sidemarkId,
  tenantId,
  onSuccess,
  classes = [],
  classOptional = false,
  shipmentCoverageType,
}: AddShipmentItemDialogProps) {
  const { toast } = useToast();
  const { profile } = useAuth();
  const [saving, setSaving] = useState(false);

  // Form state
  const [description, setDescription] = useState('');
  const [vendor, setVendor] = useState('');
  const [sidemark, setSidemark] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [selectedClass, setSelectedClass] = useState('');

  // Field suggestions - async search with previously used values
  const { suggestions: vendorSuggestions, addOrUpdateSuggestion: addVendorSuggestion } = useFieldSuggestions('vendor');
  const { suggestions: descriptionSuggestions, addOrUpdateSuggestion: addDescSuggestion } = useFieldSuggestions('description');
  const { suggestions: sidemarkSuggestions, addOrUpdateSuggestion: addSidemarkSuggestion } = useFieldSuggestions('sidemark');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!description.trim()) {
      toast({ title: 'Description required', variant: 'destructive' });
      return;
    }

    if (!classOptional && !selectedClass.trim()) {
      toast({ title: 'Class required', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      // Find the class by code or ID (optional for client submissions)
      const matchedClass = selectedClass.trim()
        ? classes.find(c => c.code === selectedClass || c.id === selectedClass)
        : null;
      if (!classOptional && !matchedClass) {
        toast({ title: 'Invalid class', description: `Class "${selectedClass}" not found. Select a valid class.`, variant: 'destructive' });
        setSaving(false);
        return;
      }
      const itemQuantity = parseInt(quantity) || 1;

      let itemId: string | null = null;

      // Create actual item record if we have the required data
      if (tenantId && accountId && warehouseId) {
        let classCubicFeet: number | null = null;
        if (matchedClass?.id) {
          try {
            const { data: classRow } = await (supabase.from('classes') as any)
              .select('min_cubic_feet, max_cubic_feet')
              .eq('tenant_id', tenantId)
              .eq('id', matchedClass.id)
              .maybeSingle();
            classCubicFeet = classRow ? getClassCubicFeetSingleValue(classRow) : null;
          } catch {
            // ignore
          }
        }

        // If shipment has paid coverage, newly added items get coverage_type='pending'
        const hasPaidCoverage = shipmentCoverageType === 'full_replacement_no_deductible' || shipmentCoverageType === 'full_replacement_deductible';
        const itemPayload: Record<string, unknown> = {
          tenant_id: tenantId,
          account_id: accountId,
          warehouse_id: warehouseId,
          description: description.trim(),
          vendor: vendor.trim() || null,
          quantity: itemQuantity,
          class_id: matchedClass?.id || null,
          size: classCubicFeet,
          size_unit: classCubicFeet !== null ? 'cu_ft' : null,
          sidemark_id: sidemarkId || null,
          receiving_shipment_id: shipmentId,
          status: 'pending_receipt',
          ...(hasPaidCoverage ? { coverage_type: 'pending' } : {}),
        };

        const { data: newItem, error: itemError } = await (supabase.from('items') as any)
          .insert(itemPayload)
          .select('id')
          .single();

        if (itemError) {
          console.error('Error creating item:', itemError);
          throw itemError;
        }

        itemId = newItem?.id || null;
      }

      // Create shipment_item linking to the item
      const { error } = await (supabase.from('shipment_items') as any).insert({
        shipment_id: shipmentId,
        item_id: itemId,
        expected_description: description.trim(),
        expected_vendor: vendor.trim() || null,
        expected_sidemark: sidemark.trim() || null,
        expected_class_id: matchedClass?.id || null,
        expected_quantity: itemQuantity,
        status: 'pending',
      });

      if (error) throw error;

      // Activity log (best-effort)
      if (profile?.tenant_id && profile?.id) {
        void (async () => {
          let shipmentNumber: string | null = null;
          let shipmentType: string | null = null;
          try {
            const { data: shipRow } = await (supabase.from('shipments') as any)
              .select('shipment_number, shipment_type')
              .eq('id', shipmentId)
              .maybeSingle();
            shipmentNumber = shipRow?.shipment_number || null;
            shipmentType = shipRow?.shipment_type || null;
          } catch {
            // ignore
          }

          const promises: Promise<void>[] = [];

          if (itemId) {
            promises.push(
              logActivity({
                entityType: 'item',
                tenantId: profile.tenant_id,
                entityId: itemId,
                actorUserId: profile.id,
                eventType: 'item_shipment_linked',
                eventLabel: `Added to shipment ${shipmentNumber || 'SHP'}`,
                details: {
                  shipment_id: shipmentId,
                  shipment_number: shipmentNumber,
                  shipment_type: shipmentType,
                  expected_description: description.trim(),
                  expected_vendor: vendor.trim() || null,
                  expected_quantity: itemQuantity,
                  expected_class_id: matchedClass?.id || null,
                },
              })
            );
          }

          promises.push(
            logActivity({
              entityType: 'shipment',
              tenantId: profile.tenant_id,
              entityId: shipmentId,
              actorUserId: profile.id,
              eventType: 'item_added',
              eventLabel: `Expected item added: ${description.trim()}`,
              details: {
                item_id: itemId,
                expected_description: description.trim(),
                expected_vendor: vendor.trim() || null,
                expected_quantity: itemQuantity,
                expected_class_id: matchedClass?.id || null,
              },
            })
          );

          await Promise.allSettled(promises);
        })();
      }

      // Record field usage for future suggestions
      if (vendor) addVendorSuggestion(vendor);
      if (description) addDescSuggestion(description);
      if (sidemark) addSidemarkSuggestion(sidemark);

      toast({ title: 'Item added to shipment' });

      // Reset form
      setDescription('');
      setVendor('');
      setSidemark('');
      setQuantity('1');
      setSelectedClass('');

      onOpenChange(false);
      onSuccess();
    } catch (error) {
      console.error('Error adding item:', error);
      toast({ title: 'Error', description: 'Failed to add item', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Expected Item</DialogTitle>
          <DialogDescription>
            Add an item that is expected to arrive in this shipment.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="description">Description *</Label>
            <AutocompleteInput
              value={description}
              onChange={setDescription}
              suggestions={descriptionSuggestions.map(s => ({ value: s.value, label: s.value }))}
              placeholder="e.g., Leather Sofa, 3-Seater"
            />
          </div>

          <div className="grid gap-4 grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="vendor">Vendor</Label>
              <AutocompleteInput
                value={vendor}
                onChange={setVendor}
                suggestions={vendorSuggestions}
                placeholder="Vendor name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quantity">Expected Qty</Label>
              <Input
                id="quantity"
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                min="1"
              />
            </div>
          </div>

          <div className="grid gap-4 grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="class">Class{!classOptional && ' *'}</Label>
              <AutocompleteInput
                value={selectedClass}
                onChange={setSelectedClass}
                suggestions={classes.map(c => ({ value: c.code, label: `${c.code} - ${c.name}` }))}
                placeholder="Size class"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sidemark">Sidemark</Label>
              <AutocompleteInput
                value={sidemark}
                onChange={setSidemark}
                suggestions={sidemarkSuggestions}
                placeholder="Sidemark"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? (
                <>
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                <>
                  <MaterialIcon name="add" size="sm" className="mr-2" />
                  Add Item
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
