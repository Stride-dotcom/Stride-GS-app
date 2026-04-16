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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { queueAlert } from '@/lib/alertQueue';
import { Badge } from '@/components/ui/badge';
import { coerceOutboundShipmentNumber } from '@/lib/shipmentNumberUtils';

interface ReleaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedItems: SelectedItem[];
  onSuccess: () => void;
}

interface SelectedItem {
  id: string;
  item_code: string;
  description: string | null;
  quantity: number;
  client_account: string | null;
}

interface Account {
  id: string;
  account_name: string;
  account_code: string;
}

interface Warehouse {
  id: string;
  name: string;
}

type ReleaseType = 'will_call' | 'disposal';

export function ReleaseDialog({ open, onOpenChange, selectedItems, onSuccess }: ReleaseDialogProps) {
  const [releaseType, setReleaseType] = useState<ReleaseType>('will_call');
  const [accountId, setAccountId] = useState<string>('none');
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [releaseToName, setReleaseToName] = useState('');
  const [releaseToEmail, setReleaseToEmail] = useState('');
  const [releaseToPhone, setReleaseToPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      fetchData();
    }
  }, [open]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [accountsRes, warehousesRes] = await Promise.all([
        supabase
          .from('accounts')
          .select('id, account_name, account_code')
          .eq('status', 'active')
          .is('deleted_at', null)
          .order('account_name'),
        supabase
          .from('warehouses')
          .select('id, name')
          .eq('status', 'active')
          .is('deleted_at', null)
          .order('name'),
      ]);

      if (accountsRes.error) throw accountsRes.error;
      if (warehousesRes.error) throw warehousesRes.error;

      setAccounts(accountsRes.data || []);
      setWarehouses(warehousesRes.data || []);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (selectedItems.length === 0) {
      toast({
        title: 'No items selected',
        description: 'Please select at least one item to release.',
        variant: 'destructive',
      });
      return;
    }

    if (!warehouseId) {
      toast({
        title: 'Warehouse required',
        description: 'Please select a warehouse.',
        variant: 'destructive',
      });
      return;
    }

    if (releaseType === 'will_call' && !releaseToName) {
      toast({
        title: 'Release To name required',
        description: 'Please enter the name of the person picking up.',
        variant: 'destructive',
      });
      return;
    }

    setSubmitting(true);
    try {
      // Get current user's profile
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: profile } = await (supabase
        .from('users') as any)
        .select('id, tenant_id')
        .eq('auth_id', user.id)
        .single();

      if (!profile) throw new Error('User profile not found');

      // Create the outbound shipment
      const shipmentData = {
        tenant_id: profile.tenant_id,
        shipment_type: 'outbound',
        release_type: releaseType,
        status: 'expected',
        account_id: accountId === 'none' ? null : accountId || null,
        warehouse_id: warehouseId,
        release_to_name: releaseToName || null,
        release_to_email: releaseToEmail || null,
        release_to_phone: releaseToPhone || null,
        notes: notes || null,
        created_by: profile.id,
      };

      const { data: shipment, error: shipmentError } = await (supabase
        .from('shipments') as any)
        .insert(shipmentData)
        .select('id, shipment_number')
        .single();

      if (shipmentError) throw shipmentError;
      let effectiveShipmentNumber: string | null = shipment.shipment_number;

      // Coerce legacy SHP-###### → OUT-##### for new outbound shipments (best-effort).
      const coerced = coerceOutboundShipmentNumber(effectiveShipmentNumber);
      if (coerced) {
        const { error: renumberError } = await (supabase.from('shipments') as any)
          .update({ shipment_number: coerced })
          .eq('tenant_id', profile.tenant_id)
          .eq('id', shipment.id);
        if (!renumberError) {
          effectiveShipmentNumber = coerced;
        }
      }

      // Create shipment items linking to actual inventory items
      const shipmentItems = selectedItems.map(item => ({
        shipment_id: shipment.id,
        item_id: item.id,
        expected_quantity: item.quantity,
        expected_description: item.description,
        status: 'pending',
      }));

      const { error: itemsError } = await (supabase
        .from('shipment_items') as any)
        .insert(shipmentItems);

      if (itemsError) throw itemsError;

      // Queue release.created alert
      await queueAlert({
        tenantId: profile.tenant_id,
        alertType: 'release.created',
        entityType: 'shipment',
        entityId: shipment.id,
        subject: `📦 ${releaseType === 'will_call' ? 'Will Call' : 'Disposal'} ${effectiveShipmentNumber} created`,
      });

      toast({
        title: 'Release created',
        description: `${releaseType === 'will_call' ? 'Will Call' : 'Disposal'} ${effectiveShipmentNumber} created with ${selectedItems.length} item(s).`,
      });

      onSuccess();
      onOpenChange(false);
      resetForm();
    } catch (error: any) {
      console.error('Error creating release:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to create release.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setReleaseType('will_call');
    setAccountId('none');
    setWarehouseId('');
    setReleaseToName('');
    setReleaseToEmail('');
    setReleaseToPhone('');
    setNotes('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {releaseType === 'will_call' ? (
              <MaterialIcon name="inventory_2" size="md" />
            ) : (
              <MaterialIcon name="delete" size="md" />
            )}
            Create Release
          </DialogTitle>
          <DialogDescription>
            Create a {releaseType === 'will_call' ? 'Will Call pickup' : 'Disposal'} for {selectedItems.length} selected item(s).
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Release Type */}
            <div className="space-y-2">
              <Label>Release Type</Label>
              <Select value={releaseType} onValueChange={(v) => setReleaseType(v as ReleaseType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="will_call">Will Call (Customer Pickup)</SelectItem>
                  <SelectItem value="disposal">Disposal</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Selected Items Summary */}
            <div className="space-y-2">
              <Label>Selected Items ({selectedItems.length})</Label>
              <div className="border rounded-md p-3 max-h-32 overflow-y-auto bg-muted/30">
                <div className="space-y-1">
                  {selectedItems.map((item) => (
                    <div key={item.id} className="flex items-center justify-between text-sm">
                      <span className="font-medium">{item.item_code}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground truncate max-w-[150px]">
                          {item.description || 'No description'}
                        </span>
                        <Badge variant="outline">Qty: {item.quantity}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Account */}
              <div className="space-y-2">
                <Label>Account (Optional)</Label>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select account" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Account</SelectItem>
                    {accounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.account_name} ({account.account_code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Warehouse */}
              <div className="space-y-2">
                <Label>Warehouse *</Label>
                <Select value={warehouseId} onValueChange={setWarehouseId}>
                  <SelectTrigger>
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

            {/* Will Call specific fields */}
            {releaseType === 'will_call' && (
              <div className="space-y-4 p-4 border rounded-md bg-muted/20">
                <h4 className="font-medium">Pickup Information</h4>
                <div className="grid grid-cols-1 gap-4">
                  <div className="space-y-2">
                    <Label>Picking Up (Name) *</Label>
                    <Input
                      placeholder="Name of person picking up"
                      value={releaseToName}
                      onChange={(e) => setReleaseToName(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Email</Label>
                      <Input
                        type="email"
                        placeholder="email@example.com"
                        value={releaseToEmail}
                        onChange={(e) => setReleaseToEmail(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Phone</Label>
                      <Input
                        placeholder="Phone number"
                        value={releaseToPhone}
                        onChange={(e) => setReleaseToPhone(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Notes */}
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                placeholder="Additional notes..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={submitting || loading}>
            {submitting && <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />}
            Create {releaseType === 'will_call' ? 'Will Call' : 'Disposal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
