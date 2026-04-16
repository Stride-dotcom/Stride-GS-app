/**
 * AddItemDialog Component
 * Dialog for adding new items directly to inventory
 */

import { useState, useEffect, useRef } from 'react';
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
import { Button } from '@/components/ui/button';
import { SaveButton } from '@/components/ui/SaveButton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AutocompleteInput } from '@/components/ui/autocomplete-input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SidemarkSelect } from '@/components/ui/sidemark-select';
import { supabase } from '@/integrations/supabase/client';
import { useFieldSuggestions } from '@/hooks/useFieldSuggestions';
import { useAccounts } from '@/hooks/useAccounts';
import { useWarehouses } from '@/hooks/useWarehouses';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useItemDisplaySettings } from '@/hooks/useItemDisplaySettings';
import { isEmptyCustomFieldValue } from '@/lib/items/itemDisplaySettings';
import type { BuiltinItemColumnKey } from '@/lib/items/itemDisplaySettings';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

interface AddItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function AddItemDialog({
  open,
  onOpenChange,
  onSuccess,
}: AddItemDialogProps) {
  const { toast } = useToast();
  const { profile } = useAuth();
  const { accounts, loading: accountsLoading } = useAccounts();
  const { warehouses } = useWarehouses();
  const { settings: itemDisplaySettings } = useItemDisplaySettings();
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  // Form state
  const [accountId, setAccountId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [vendor, setVendor] = useState('');
  const [sku, setSku] = useState('');
  const [description, setDescription] = useState('');
  const [sidemarkId, setSidemarkId] = useState('');
  const [room, setRoom] = useState('');
  const [notes, setNotes] = useState('');
  const [customFieldDraft, setCustomFieldDraft] = useState<Record<string, unknown>>({});

  // Field suggestions
  const { suggestions: vendorSuggestions, addOrUpdateSuggestion: addVendorSuggestion } = useFieldSuggestions('vendor');
  const { suggestions: skuSuggestions, addOrUpdateSuggestion: addSkuSuggestion } = useFieldSuggestions('sku');
  const { suggestions: roomSuggestions, addOrUpdateSuggestion: addRoomSuggestion } = useFieldSuggestions('room');

  const customFieldsForForm = itemDisplaySettings.custom_fields.filter((f) => f.enabled && f.show_on_detail);

  const isRequiredBuiltin = (key: BuiltinItemColumnKey) => itemDisplaySettings.required_builtin?.[key] === true;

  const hasCustomFieldData = Object.values(customFieldDraft).some((v) => {
    if (v === null || v === undefined) return false;
    if (typeof v === 'string') return v.trim().length > 0;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return true;
    return true;
  });

  // Track if form has been modified
  const hasFormData = accountId || vendor || sku || description || sidemarkId || room || notes || quantity !== '1' || hasCustomFieldData;

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setAccountId('');
      setQuantity('1');
      setVendor('');
      setSku('');
      setDescription('');
      setSidemarkId('');
      setRoom('');
      setNotes('');
      setCustomFieldDraft({});
    }
  }, [open]);

  const handleClose = (shouldClose: boolean) => {
    if (!shouldClose) return;

    // If form has data, show confirmation
    if (hasFormData) {
      setShowCloseConfirm(true);
    } else {
      onOpenChange(false);
    }
  };

  const handleConfirmClose = () => {
    setShowCloseConfirm(false);
    onOpenChange(false);
  };

  const handleSave = async () => {
    // Validate required fields
    if (!accountId) {
      toast({
        variant: 'destructive',
        title: 'Account Required',
        description: 'Please select an account for this item.',
      });
      throw new Error('Account required');
    }

    if (isRequiredBuiltin('vendor') && !vendor.trim()) {
      toast({ variant: 'destructive', title: 'Vendor Required', description: 'Please enter a vendor.' });
      throw new Error('Vendor required');
    }
    if (isRequiredBuiltin('sku') && !sku.trim()) {
      toast({ variant: 'destructive', title: 'SKU Required', description: 'Please enter an SKU.' });
      throw new Error('SKU required');
    }
    if (isRequiredBuiltin('description') && !description.trim()) {
      toast({ variant: 'destructive', title: 'Description Required', description: 'Please enter a description.' });
      throw new Error('Description required');
    }
    if (isRequiredBuiltin('sidemark') && !sidemarkId) {
      toast({ variant: 'destructive', title: 'Sidemark Required', description: 'Please select a sidemark.' });
      throw new Error('Sidemark required');
    }
    if (isRequiredBuiltin('room') && !room.trim()) {
      toast({ variant: 'destructive', title: 'Room Required', description: 'Please enter a room.' });
      throw new Error('Room required');
    }

    for (const f of customFieldsForForm) {
      if (f.required !== true) continue;
      const raw = customFieldDraft[f.key];
      if (isEmptyCustomFieldValue(f as any, raw)) {
        toast({
          variant: 'destructive',
          title: 'Required field missing',
          description: `${f.label} is required.`,
        });
        throw new Error('Custom field required');
      }
    }

    if (!profile?.tenant_id) return;

    try {
      // Get default warehouse
      const defaultWarehouseId = warehouses?.[0]?.id;
      if (!defaultWarehouseId) {
        throw new Error('No warehouse configured. Please add a warehouse first.');
      }

      const { data: newItem, error } = await (supabase.from('items') as any).insert([{
        tenant_id: profile.tenant_id,
        warehouse_id: defaultWarehouseId,
        // item_code is assigned by DB trigger (sequential) when omitted.
        account_id: accountId,
        quantity: parseInt(quantity, 10) || 1,
        vendor: vendor || null,
        description: description || null,
        sidemark_id: sidemarkId || null,
        room: room || null,
        metadata: (() => {
          const custom_fields: Record<string, unknown> = {};
          for (const f of customFieldsForForm) {
            const raw = customFieldDraft[f.key];
            if (raw === undefined || raw === null) continue;

            if (f.type === 'checkbox') {
              if (raw === true) custom_fields[f.key] = true;
              continue;
            }

            if (f.type === 'number') {
              const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
              if (Number.isFinite(n)) custom_fields[f.key] = n;
              continue;
            }

            const s = String(raw).trim();
            if (s) custom_fields[f.key] = s;
          }

          return Object.keys(custom_fields).length > 0 ? { custom_fields } : null;
        })(),
        status: 'in_storage',
      }]).select('id, item_code').single();

      if (error) throw error;

      // Add notes to item_notes table if provided
      if (notes && newItem?.id) {
        await supabase.from('item_notes').insert([{
          item_id: newItem.id,
          note: notes,
          visibility: 'internal',
          created_by: profile.id,
        }]);
      }

      // Add suggestions for autocomplete
      if (vendor) addVendorSuggestion(vendor);
      if (sku) addSkuSuggestion(sku);
      if (room) addRoomSuggestion(room);

      toast({
        title: 'Item Added',
        description: `Item ${newItem?.item_code || ''} has been created.`,
      });

      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error adding item:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to add item',
      });
      throw error;
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[500px] max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <MaterialIcon name="add" size="md" />
              Add New Item
            </DialogTitle>
            <DialogDescription>
              Add a new item directly to inventory.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={(e) => e.preventDefault()} className="flex-1 overflow-y-auto min-h-0 space-y-4 pr-2">
            {/* Account - Required */}
            <div className="space-y-2">
              <Label htmlFor="account" className="flex items-center gap-1">
                Account <span className="text-destructive">*</span>
              </Label>
              <SearchableSelect
                options={(accounts || []).filter(a => a.status === 'active').map(a => ({ value: a.id, label: a.account_name }))}
                value={accountId}
                onChange={setAccountId}
                placeholder="Select account..."
                loading={accountsLoading}
              />
            </div>

            {/* Quantity */}
            <div className="space-y-2">
              <Label htmlFor="quantity">Quantity</Label>
              <Input
                id="quantity"
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="1"
              />
            </div>

            {/* Vendor */}
            <div className="space-y-2">
              <Label htmlFor="vendor" className="flex items-center gap-1">
                Vendor {isRequiredBuiltin('vendor') ? <span className="text-destructive">*</span> : null}
              </Label>
              <AutocompleteInput
                value={vendor}
                onChange={setVendor}
                suggestions={vendorSuggestions}
                placeholder="Enter vendor name..."
              />
            </div>

            {/* SKU */}
            <div className="space-y-2">
              <Label htmlFor="sku" className="flex items-center gap-1">
                {isRequiredBuiltin('sku') ? 'SKU' : 'SKU (optional)'}{' '}
                {isRequiredBuiltin('sku') ? <span className="text-destructive">*</span> : null}
              </Label>
              <AutocompleteInput
                value={sku}
                onChange={setSku}
                suggestions={skuSuggestions}
                placeholder="e.g., MFG-12345"
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description" className="flex items-center gap-1">
                Description {isRequiredBuiltin('description') ? <span className="text-destructive">*</span> : null}
              </Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Item description..."
                rows={2}
              />
            </div>

            {/* Sidemark */}
            <div className="space-y-2">
              <Label htmlFor="sidemark" className="flex items-center gap-1">
                Sidemark {isRequiredBuiltin('sidemark') ? <span className="text-destructive">*</span> : null}
              </Label>
              <SidemarkSelect
                accountId={accountId}
                value={sidemarkId}
                onChange={setSidemarkId}
                placeholder="Select sidemark..."
                allowCreate
              />
            </div>

            {/* Room */}
            <div className="space-y-2">
              <Label htmlFor="room" className="flex items-center gap-1">
                Room {isRequiredBuiltin('room') ? <span className="text-destructive">*</span> : null}
              </Label>
              <AutocompleteInput
                value={room}
                onChange={setRoom}
                suggestions={roomSuggestions}
                placeholder="e.g., Living Room"
              />
            </div>

            {/* Custom Fields */}
            {customFieldsForForm.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Custom Fields</Label>
                  <span className="text-xs text-muted-foreground">Saved on the item</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {customFieldsForForm.map((f) => {
                    const raw = customFieldDraft[f.key];
                    const stringVal = raw === null || raw === undefined ? '' : String(raw);
                    const dateVal = stringVal && stringVal.includes('T') ? stringVal.slice(0, 10) : stringVal;
                    const checked = raw === true || raw === 'true' || raw === 1 || raw === '1';

                    return (
                      <div key={f.id} className="space-y-1">
                        <Label className="text-xs text-muted-foreground flex items-center gap-1">
                          {f.label} {f.required === true && f.type !== 'checkbox' ? <span className="text-destructive">*</span> : null}
                        </Label>
                        {f.type === 'select' ? (
                          <Select
                            value={stringVal || '__none__'}
                            onValueChange={(val) => {
                              const next = val === '__none__' ? '' : val;
                              setCustomFieldDraft((prev) => ({ ...prev, [f.key]: next }));
                            }}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder="Select…" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">-</SelectItem>
                              {(f.options || []).map((opt) => (
                                <SelectItem key={opt} value={opt}>
                                  {opt}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : f.type === 'checkbox' ? (
                          <div className="h-9 flex items-center">
                            <Switch
                              checked={checked}
                              onCheckedChange={(val) => setCustomFieldDraft((prev) => ({ ...prev, [f.key]: val }))}
                            />
                          </div>
                        ) : (
                          <Input
                            value={f.type === 'date' ? dateVal : stringVal}
                            type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                            onChange={(e) => setCustomFieldDraft((prev) => ({ ...prev, [f.key]: e.target.value }))}
                            placeholder="-"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Additional notes..."
                rows={2}
              />
            </div>
          </form>

          <DialogFooter className="flex-shrink-0 pt-4 border-t mt-4">
            <Button type="button" variant="outline" onClick={() => handleClose(true)}>
              Cancel
            </Button>
            <SaveButton
              onClick={handleSave}
              label="Add Item"
              savingLabel="Adding..."
              savedLabel="Added"
              icon="add"
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close Confirmation Dialog */}
      <AlertDialog open={showCloseConfirm} onOpenChange={setShowCloseConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard Changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Are you sure you want to close this dialog? Your changes will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continue Editing</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmClose}>Discard</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
