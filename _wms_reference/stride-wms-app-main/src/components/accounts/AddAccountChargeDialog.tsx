/**
 * AddAccountChargeDialog - Add billing charges directly to an account
 * Used for account-level charges not tied to a specific inventory item
 */

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
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
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { createBillingEvent } from '@/lib/billing/createBillingEvent';
import { BILLING_DISABLED_ERROR } from '@/lib/billing/chargeTypeUtils';

interface ServiceEvent {
  id: string;
  service_code: string;
  service_name: string;
  rate: number;
}

interface AddAccountChargeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  accountName: string;
  onSuccess: () => void;
}

export function AddAccountChargeDialog({
  open,
  onOpenChange,
  accountId,
  accountName,
  onSuccess,
}: AddAccountChargeDialogProps) {
  const { toast } = useToast();
  const { profile } = useAuth();

  const [loading, setLoading] = useState(false);
  const [services, setServices] = useState<ServiceEvent[]>([]);
  const [chargeType, setChargeType] = useState<'custom' | 'service'>('custom');
  const [selectedService, setSelectedService] = useState<string>('');

  const [formData, setFormData] = useState({
    charge_name: '',
    amount: '',
    quantity: '1',
    description: '',
  });

  useEffect(() => {
    if (open) {
      fetchServices();
      setChargeType('custom');
      setSelectedService('');
      setFormData({ charge_name: '', amount: '', quantity: '1', description: '' });
    }
  }, [open]);

  const fetchServices = async () => {
    if (!profile?.tenant_id) return;
    try {
      const { data, error } = await (supabase
        .from('service_events') as any)
        .select('id, service_code, service_name, rate')
        .eq('tenant_id', profile.tenant_id)
        .eq('is_active', true)
        .order('service_name');

      if (error) throw error;
      setServices(data || []);
    } catch (error) {
      console.error('Error fetching services:', error);
      setServices([]);
    }
  };

  const handleServiceSelect = (serviceId: string) => {
    setSelectedService(serviceId);
    const service = services.find(s => s.id === serviceId);
    if (service) {
      setFormData(prev => ({
        ...prev,
        charge_name: service.service_name,
        amount: service.rate.toString(),
      }));
    }
  };

  const handleSubmit = async () => {
    if (!profile?.tenant_id) return;

    const chargeName = formData.charge_name.trim();
    if (!chargeName) {
      toast({
        title: 'Charge name required',
        description: 'Please enter a charge name.',
        variant: 'destructive',
      });
      return;
    }

    const amount = parseFloat(formData.amount);
    if (isNaN(amount) || amount <= 0) {
      toast({
        title: 'Valid amount required',
        description: 'Please enter a valid positive amount.',
        variant: 'destructive',
      });
      return;
    }

    const quantity = parseInt(formData.quantity) || 1;

    setLoading(true);
    try {
      // Check account_service_settings for is_enabled before creating billing event
      if (accountId && chargeName) {
        const { data: accountSetting } = await supabase
          .from('account_service_settings')
          .select('is_enabled')
          .eq('account_id', accountId)
          .eq('service_code', chargeName)
          .maybeSingle();

        if (accountSetting && accountSetting.is_enabled === false) {
          throw new Error(BILLING_DISABLED_ERROR);
        }
      }

      const result = await createBillingEvent({
        tenant_id: profile.tenant_id,
        account_id: accountId,
        event_type: 'addon',
        charge_type: chargeName,
        description: formData.description.trim() || undefined,
        quantity,
        unit_rate: amount,
        total_amount: quantity * amount,
        metadata: {
          source: 'account_manual_charge',
          service_id: chargeType === 'service' ? selectedService : null,
        },
        created_by: profile.id,
      });

      if (!result) {
        throw new Error('Failed to create billing event');
      }

      toast({
        title: 'Charge added',
        description: `$${(quantity * amount).toFixed(2)} charge added to ${accountName}.`,
      });

      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error adding billing event:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to add charge.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className="sm:max-w-[500px]"
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Add Account Charge</DialogTitle>
          <DialogDescription>
            Add a miscellaneous charge to {accountName}'s account. This charge is not tied to a specific inventory item.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Charge Type Selection */}
          <div className="grid gap-2">
            <Label>Charge Type</Label>
            <Select value={chargeType} onValueChange={(v) => setChargeType(v as 'custom' | 'service')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="custom">Custom Charge</SelectItem>
                <SelectItem value="service">Use Service Rate</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Service Selection (if using service rate) */}
          {chargeType === 'service' && services.length > 0 && (
            <div className="grid gap-2">
              <Label>Select Service</Label>
              <Select value={selectedService} onValueChange={handleServiceSelect}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a service..." />
                </SelectTrigger>
                <SelectContent>
                  {services.map(service => (
                    <SelectItem key={service.id} value={service.id}>
                      {service.service_name} (${(service.rate ?? 0).toFixed(2)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Charge Name */}
          <div className="grid gap-2">
            <Label htmlFor="charge_name">Charge Name *</Label>
            <Input
              id="charge_name"
              value={formData.charge_name}
              onChange={e => setFormData(prev => ({ ...prev, charge_name: e.target.value }))}
              placeholder="e.g., Materials purchase, Special handling"
              disabled={chargeType === 'service' && !!selectedService}
            />
          </div>

          {/* Amount and Quantity */}
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="amount">Unit Amount *</Label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  value={formData.amount}
                  onChange={e => setFormData(prev => ({ ...prev, amount: e.target.value }))}
                  placeholder="0.00"
                  className="pl-7"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="quantity">Quantity</Label>
              <Input
                id="quantity"
                type="number"
                min="1"
                value={formData.quantity}
                onChange={e => setFormData(prev => ({ ...prev, quantity: e.target.value }))}
              />
            </div>
          </div>

          {/* Total Preview */}
          {formData.amount && (
            <div className="bg-muted/50 rounded-lg p-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Total Amount:</span>
                <span className="font-bold text-lg">
                  ${((parseFloat(formData.amount) || 0) * (parseInt(formData.quantity) || 1)).toFixed(2)}
                </span>
              </div>
            </div>
          )}

          {/* Description */}
          <div className="grid gap-2">
            <Label htmlFor="description">Notes (optional)</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Additional details for this charge..."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />}
            Add Charge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
