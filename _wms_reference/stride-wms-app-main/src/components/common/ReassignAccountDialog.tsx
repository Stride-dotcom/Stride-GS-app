import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/lib/toastShim';
import { queueShipmentReceivedAlert } from '@/lib/alertQueue';

interface Account {
  id: string;
  account_code: string;
  account_name: string;
}

interface ReassignAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: 'item' | 'shipment' | 'items';
  entityIds: string[];
  currentAccountId?: string | null;
  currentAccountName?: string | null;
  onSuccess: () => void;
  onShipmentCreated?: (shipmentId: string) => void;
  tenantId?: string;
  userId?: string;
}

export function ReassignAccountDialog({
  open,
  onOpenChange,
  entityType,
  entityIds,
  currentAccountId,
  currentAccountName,
  onSuccess,
  onShipmentCreated,
  tenantId,
  userId,
}: ReassignAccountDialogProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const appendUnifiedShipmentNote = async (
    shipmentId: string,
    shipmentNumber: string | null | undefined,
    noteText: string,
    metadata: Record<string, unknown>
  ) => {
    const trimmed = noteText.trim();
    if (!trimmed) return;
    const { error } = await (supabase as any).rpc('create_unified_note', {
      p_entity_type: 'shipment',
      p_entity_id: shipmentId,
      p_note_text: trimmed,
      p_note_type: 'internal',
      p_source_entity_number: shipmentNumber || null,
      p_metadata: {
        source: 'reassign_account_dialog',
        ...metadata,
      },
    });
    if (error) {
      console.warn('[ReassignAccountDialog] Failed to append unified shipment note:', error.message);
    }
  };

  useEffect(() => {
    if (open) {
      fetchAccounts();
      setSelectedAccountId('');
    }
  }, [open]);

  const fetchAccounts = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('accounts')
        .select('id, account_code, account_name')
        .eq('status', 'active')
        .is('deleted_at', null)
        .order('account_name');

      if (error) throw error;
      setAccounts(data || []);
    } catch (error) {
      console.error('Error fetching accounts:', error);
      toast.error('Failed to load accounts');
    } finally {
      setLoading(false);
    }
  };

  const handleReassign = async () => {
    if (!selectedAccountId) {
      toast.error('Please select an account');
      return;
    }

    setSubmitting(true);
    let lastCreatedShipmentId: string | null = null;
    try {
      const selectedAccount = accounts.find(a => a.id === selectedAccountId);

      if (entityType === 'shipment') {
        // Update shipment account
        const { error } = await supabase
          .from('shipments')
          .update({ account_id: selectedAccountId })
          .in('id', entityIds);

        if (error) throw error;

        // Also reassign all items on these shipments to the new account
        for (const shipmentId of entityIds) {
          await supabase
            .from('items')
            .update({ account_id: selectedAccountId })
            .eq('receiving_shipment_id', shipmentId)
            .is('deleted_at', null);
        }

        // Log to audit log if tenantId and userId are provided
        if (tenantId && userId) {
          for (const entityId of entityIds) {
            await supabase.from('admin_audit_log').insert({
              tenant_id: tenantId,
              actor_id: userId,
              entity_type: 'shipment',
              entity_id: entityId,
              action: 'account_reassigned',
              changes_json: {
                previous_account_id: currentAccountId,
                previous_account_name: currentAccountName,
                new_account_id: selectedAccountId,
                new_account_name: selectedAccount?.account_name,
              },
            });
          }
        }

        toast.success(`Shipment and all items reassigned to ${selectedAccount?.account_name}`);
      } else {
        // Item reassignment with automatic shipment split
        // 1. Fetch items to discover their source shipments
        const { data: itemsWithShipments, error: fetchErr } = await supabase
          .from('items')
          .select('id, receiving_shipment_id')
          .in('id', entityIds);

        if (fetchErr) throw fetchErr;

        // 2. Group items by their source shipment
        const shipmentGroups = new Map<string, string[]>();
        for (const item of itemsWithShipments || []) {
          if (item.receiving_shipment_id) {
            const group = shipmentGroups.get(item.receiving_shipment_id) || [];
            group.push(item.id);
            shipmentGroups.set(item.receiving_shipment_id, group);
          }
        }

        // 3. Handle shipment splits / full moves
        const newShipmentNumbers: string[] = [];

        for (const [shipmentId, movingItemIds] of shipmentGroups) {
          // Count total items on this shipment (that aren't deleted)
          const { count: totalOnShipment } = await supabase
            .from('items')
            .select('id', { count: 'exact', head: true })
            .eq('receiving_shipment_id', shipmentId)
            .is('deleted_at', null);

          if (totalOnShipment && totalOnShipment === movingItemIds.length) {
            // ALL items from this shipment are moving → reassign the whole shipment
            await supabase
              .from('shipments')
              .update({ account_id: selectedAccountId })
              .eq('id', shipmentId);
          } else {
            // PARTIAL split → create a new shipment for the new account
            const { data: sourceShipment } = await supabase
              .from('shipments')
              .select('*')
              .eq('id', shipmentId)
              .single();

            if (sourceShipment) {
              // Build new shipment payload (copy all details, photos, documents, notes)
              const {
                id: _id,
                shipment_number: _num,
                created_at: _ca,
                updated_at: _ua,
                deleted_at: _da,
                portal_request_id: _pr,
                ...shipmentDetails
              } = sourceShipment;

              const splitNote = `Split from shipment ${sourceShipment.shipment_number}`;
              const { data: newShipment, error: createErr } = await (supabase as any)
                .from('shipments')
                .insert({
                  ...shipmentDetails,
                  account_id: selectedAccountId,
                  notes: shipmentDetails.notes
                    ? `${shipmentDetails.notes}\n\n${splitNote}`
                    : splitNote,
                  created_by: userId || shipmentDetails.created_by,
                })
                .select('id, shipment_number')
                .single();

              if (createErr) throw createErr;

              if (newShipment) {
                await appendUnifiedShipmentNote(
                  newShipment.id,
                  newShipment.shipment_number,
                  splitNote,
                  {
                    action: 'shipment_split_created',
                    source_shipment_id: shipmentId,
                    source_shipment_number: sourceShipment.shipment_number,
                    selected_account_id: selectedAccountId,
                  }
                );

                newShipmentNumbers.push(newShipment.shipment_number);
                lastCreatedShipmentId = newShipment.id;

                // Point the moved items at the new shipment
                await supabase
                  .from('items')
                  .update({ receiving_shipment_id: newShipment.id })
                  .in('id', movingItemIds);

                // Copy shipment_items records for the moved items
                const { data: existingShipmentItems } = await supabase
                  .from('shipment_items')
                  .select('*')
                  .eq('shipment_id', shipmentId)
                  .in('item_id', movingItemIds);

                if (existingShipmentItems?.length) {
                  const copied = existingShipmentItems.map(
                    ({ id: _siId, created_at: _siCa, updated_at: _siUa, ...rest }) => ({
                      ...rest,
                      shipment_id: newShipment.id,
                    })
                  );
                  await supabase.from('shipment_items').insert(copied);
                }

                // Add a note to the source shipment about the split
                const sourceNote = `Items split to shipment ${newShipment.shipment_number} (${selectedAccount?.account_name})`;
                await supabase
                  .from('shipments')
                  .update({
                    notes: sourceShipment.notes
                      ? `${sourceShipment.notes}\n\n${sourceNote}`
                      : sourceNote,
                  })
                  .eq('id', shipmentId);

                await appendUnifiedShipmentNote(
                  shipmentId,
                  sourceShipment.shipment_number,
                  sourceNote,
                  {
                    action: 'shipment_split_source_updated',
                    created_shipment_id: newShipment.id,
                    created_shipment_number: newShipment.shipment_number,
                    selected_account_id: selectedAccountId,
                  }
                );

                // Queue shipment received alert for the new account
                if (tenantId) {
                  await queueShipmentReceivedAlert(
                    tenantId,
                    newShipment.id,
                    newShipment.shipment_number,
                    movingItemIds.length
                  );
                }
              }
            }
          }
        }

        // 4. Update all items' account_id
        const { error } = await supabase
          .from('items')
          .update({ account_id: selectedAccountId })
          .in('id', entityIds);

        if (error) throw error;

        // 5. Audit log
        if (tenantId && userId) {
          for (const entityId of entityIds) {
            await supabase.from('admin_audit_log').insert({
              tenant_id: tenantId,
              actor_id: userId,
              entity_type: 'item',
              entity_id: entityId,
              action: 'account_reassigned',
              changes_json: {
                previous_account_id: currentAccountId,
                previous_account_name: currentAccountName,
                new_account_id: selectedAccountId,
                new_account_name: selectedAccount?.account_name,
                new_shipment_numbers: newShipmentNumbers.length ? newShipmentNumbers : undefined,
              },
            });
          }
        }

        // 6. Toast with shipment split info
        const itemCount = entityIds.length;
        const baseMsg = itemCount === 1
          ? `Item reassigned to ${selectedAccount?.account_name}`
          : `${itemCount} items reassigned to ${selectedAccount?.account_name}`;
        const shipmentMsg = newShipmentNumbers.length
          ? `. New shipment${newShipmentNumbers.length > 1 ? 's' : ''} created: ${newShipmentNumbers.join(', ')}`
          : '';
        toast.success(`${baseMsg}${shipmentMsg}`);
      }

      onSuccess();
      onOpenChange(false);

      // Navigate to the new shipment if one was created from a split
      if (lastCreatedShipmentId && onShipmentCreated) {
        onShipmentCreated(lastCreatedShipmentId);
      }
    } catch (error) {
      console.error('Error reassigning:', error);
      toast.error('Failed to reassign. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const entityLabel = entityType === 'shipment'
    ? 'shipment'
    : entityIds.length === 1
      ? 'item'
      : `${entityIds.length} items`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MaterialIcon name="swap_horiz" size="md" />
            Reassign Account
          </DialogTitle>
          <DialogDescription>
            Move this {entityLabel} to a different account.
            {currentAccountName && (
              <span className="block mt-1">
                Currently assigned to: <strong>{currentAccountName}</strong>
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>New Account</Label>
            {loading ? (
              <div className="flex items-center justify-center h-10">
                <MaterialIcon name="progress_activity" size="sm" className="animate-spin text-muted-foreground" />
              </div>
            ) : (
              <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select account..." />
                </SelectTrigger>
                <SelectContent>
                  {accounts
                    .filter(a => a.id !== currentAccountId)
                    .map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        <span className="font-medium">{account.account_code}</span>
                        <span className="text-muted-foreground ml-2">- {account.account_name}</span>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleReassign} disabled={!selectedAccountId || submitting}>
            {submitting ? (
              <>
                <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                Reassigning...
              </>
            ) : (
              <>
                <MaterialIcon name="swap_horiz" size="sm" className="mr-2" />
                Reassign
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
